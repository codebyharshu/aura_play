const QRCode = require('qrcode');

/**
 * Generates a QR Code as a Data URL (base64 image)
 * @param {string} text - The URL or string to encode
 * @param {object} [options] - QR options
 * @returns {Promise<string>} Base64 Data URL
 */
async function generateQRCodeDataURL(text, options = {}) {
  try {
    const defaultOptions = {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 8,
      color: {
        dark: '#0d0f17',  // dark module for optimal camera reading
        light: '#ffffff'  // crisp white background
      },
      ...options
    };

    return await QRCode.toDataURL(text, defaultOptions);
  } catch (err) {
    console.error('Failed to generate QR code data URL:', err);
    throw err;
  }
}

/**
 * Generates an SVG string of the QR Code
 * @param {string} text
 * @returns {Promise<string>} SVG markup
 */
async function generateQRCodeSVG(text) {
  try {
    return await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: {
        dark: '#00f2fe',
        light: '#0d0f17'
      }
    });
  } catch (err) {
    console.error('Failed to generate QR code SVG:', err);
    throw err;
  }
}

module.exports = {
  generateQRCodeDataURL,
  generateQRCodeSVG
};
