using System;
using System.IO;
using System.Threading;
using NAudio.Wave;
using NAudio.CoreAudioApi;

namespace SyncWave.Audio
{
    class Program
    {
        private static WasapiLoopbackCapture capture = null;
        private static Stream stdoutStream = null;
        private static bool isRunning = true;
        private static byte[] conversionBuffer = new byte[16384];
        private static int targetSampleRate = 48000;
        private static int targetChannels = 2;

        static void Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            stdoutStream = Console.OpenStandardOutput();

            // Listen for stdin stop signal
            Thread stdinThread = new Thread(ListenForStdin);
            stdinThread.IsBackground = true;
            stdinThread.Start();

            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                StopCapture();
            };

            StartCapture();

            // Keep main thread alive while capturing
            while (isRunning)
            {
                Thread.Sleep(100);
            }
        }

        static void StartCapture()
        {
            try
            {
                var enumerator = new MMDeviceEnumerator();
                var defaultDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                
                capture = new WasapiLoopbackCapture(defaultDevice);
                var waveFormat = capture.WaveFormat;

                targetSampleRate = waveFormat.SampleRate;
                targetChannels = waveFormat.Channels;

                Console.Error.WriteLine(string.Format(
                    "[INFO] Device: \"{0}\" | InputFormat: {1}Hz, {2}ch, {3}bit {4}",
                    defaultDevice.FriendlyName,
                    waveFormat.SampleRate,
                    waveFormat.Channels,
                    waveFormat.BitsPerSample,
                    waveFormat.Encoding
                ));

                // Send machine-readable format info to supervisor on stderr
                Console.Error.WriteLine(string.Format(
                    "[SYNCWAVE_FORMAT] SampleRate={0} Channels={1} Bits=16",
                    waveFormat.SampleRate,
                    waveFormat.Channels
                ));

                capture.DataAvailable += OnDataAvailable;
                capture.RecordingStopped += OnRecordingStopped;

                capture.StartRecording();
                Console.Error.WriteLine("[SYNCWAVE_STATUS] STARTED");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[SYNCWAVE_ERROR] " + ex.Message);
                isRunning = false;
            }
        }

        static void OnDataAvailable(object sender, WaveInEventArgs e)
        {
            if (!isRunning || e.BytesRecorded == 0) return;

            try
            {
                var waveFormat = capture.WaveFormat;
                byte[] outputBytes = null;
                int outputLength = 0;

                if (waveFormat.Encoding == WaveFormatEncoding.IeeeFloat)
                {
                    // Convert 32-bit IEEE float to 16-bit signed PCM
                    int sampleCount = e.BytesRecorded / 4;
                    int requiredBytes = sampleCount * 2;

                    if (conversionBuffer.Length < requiredBytes)
                    {
                        conversionBuffer = new byte[requiredBytes * 2];
                    }

                    int outIndex = 0;
                    for (int i = 0; i < e.BytesRecorded; i += 4)
                    {
                        float sample = BitConverter.ToSingle(e.Buffer, i);
                        // Clamp to [-1.0, 1.0] to prevent audio clipping
                        if (sample > 1.0f) sample = 1.0f;
                        else if (sample < -1.0f) sample = -1.0f;

                        short pcm16 = (short)(sample * 32767.0f);
                        conversionBuffer[outIndex++] = (byte)(pcm16 & 0xFF);
                        conversionBuffer[outIndex++] = (byte)((pcm16 >> 8) & 0xFF);
                    }

                    outputBytes = conversionBuffer;
                    outputLength = outIndex;
                }
                else if (waveFormat.BitsPerSample == 16)
                {
                    // Native 16-bit PCM pass-through
                    outputBytes = e.Buffer;
                    outputLength = e.BytesRecorded;
                }
                else
                {
                    // Fallback pass-through
                    outputBytes = e.Buffer;
                    outputLength = e.BytesRecorded;
                }

                // Write raw 16-bit PCM to stdout
                lock (stdoutStream)
                {
                    stdoutStream.Write(outputBytes, 0, outputLength);
                    stdoutStream.Flush();
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[SYNCWAVE_ERROR] Error processing audio buffer: " + ex.Message);
            }
        }

        static void OnRecordingStopped(object sender, StoppedEventArgs e)
        {
            if (e.Exception != null)
            {
                Console.Error.WriteLine("[SYNCWAVE_ERROR] Recording stopped with error: " + e.Exception.Message);
            }
            else
            {
                Console.Error.WriteLine("[SYNCWAVE_STATUS] STOPPED");
            }
        }

        static void ListenForStdin()
        {
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    if (line.Trim().Equals("STOP", StringComparison.OrdinalIgnoreCase))
                    {
                        StopCapture();
                        break;
                    }
                }
            }
            catch
            {
                StopCapture();
            }
        }

        static void StopCapture()
        {
            if (!isRunning) return;
            isRunning = false;

            try
            {
                if (capture != null)
                {
                    capture.StopRecording();
                    capture.Dispose();
                    capture = null;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[SYNCWAVE_ERROR] Stop exception: " + ex.Message);
            }
        }
    }
}
