const nodemailer = require('nodemailer');
const https = require('https');

const BREVO_API_KEY = process.env.SMTP_PASSWORD || '';
const SENDER_EMAIL = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '';

/**
 * Primary HTTP API delivery via Brevo v3 HTTPS endpoint (works 100% reliably on Vercel serverless)
 */
const sendViaBrevoHttpApi = (toEmail, subject, textContent, htmlContent) => {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      sender: { name: 'Dating App Security', email: SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject,
      htmlContent,
      textContent,
    });

    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[EMAIL SERVICE] Brevo HTTP API email sent successfully to ${toEmail}. Response:`, data);
          resolve({ success: true, data });
        } else {
          reject(new Error(`Brevo HTTP API returned status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Brevo HTTP API request timed out'));
    });

    req.write(payload);
    req.end();
  });
};

const createTransporter = () => {
  const host = process.env.SMTP_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER || SENDER_EMAIL;
  const pass = BREVO_API_KEY;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
};

/**
 * Send Mobile Verification OTP via Email (HTTP API with Nodemailer fallback)
 */
const sendMobileVerificationOtp = async (toEmail, otp) => {
  const subject = 'Mobile Verification OTP - Dating App';
  const textContent = `Your OTP for mobile verification is: ${otp}. This code is valid for 10 minutes.`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #e91e63; text-align: center;">Mobile Verification</h2>
      <p style="font-size: 16px; color: #333;">Welcome! To verify your mobile number on Dating App, please use the 6-digit verification code below:</p>
      <div style="background-color: #fce4ec; border-radius: 6px; padding: 15px; text-align: center; margin: 20px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #d81b60;">${otp}</span>
      </div>
      <p style="font-size: 14px; color: #666;">This verification code is valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="font-size: 12px; color: #999; text-align: center;">If you did not request this code, please ignore this email.</p>
    </div>
  `;

  // Use Brevo HTTPS API if an xkeysib API key is provided
  if (BREVO_API_KEY.startsWith('xkeysib-')) {
    try {
      return await sendViaBrevoHttpApi(toEmail, subject, textContent, htmlContent);
    } catch (apiErr) {
      console.warn(`[EMAIL SERVICE] Brevo HTTP API failed (${apiErr.message}). Falling back to SMTP...`);
    }
  }

  // Primary SMTP delivery via Nodemailer
  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `"Dating App Security" <${SENDER_EMAIL}>`,
      to: toEmail,
      subject,
      text: textContent,
      html: htmlContent,
    });
    console.log(`[EMAIL SERVICE] SMTP OTP sent successfully to ${toEmail}. Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[EMAIL SERVICE] Error sending OTP to ${toEmail}:`, error.message);
    throw error;
  }
};


/**
 * Send Password Reset OTP via Email (HTTP API with Nodemailer fallback)
 */
const sendPasswordResetOtp = async (toEmail, otp) => {
  const subject = 'Password Reset OTP - Dating App';
  const textContent = `Your OTP for resetting your Dating App account password is: ${otp}. This code is valid for 15 minutes.`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #e91e63; text-align: center;">Password Reset Request</h2>
      <p style="font-size: 16px; color: #333;">We received a request to reset your Dating App password. Use the 6-digit verification code below to reset your password:</p>
      <div style="background-color: #fff3e0; border-radius: 6px; padding: 15px; text-align: center; margin: 20px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #e65100;">${otp}</span>
      </div>
      <p style="font-size: 14px; color: #666;">This password reset code is valid for <strong>15 minutes</strong>. If you did not request a password reset, please ignore this email or secure your account.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="font-size: 12px; color: #999; text-align: center;">Dating App Security Team</p>
    </div>
  `;

  // Try Brevo HTTPS API first
  try {
    return await sendViaBrevoHttpApi(toEmail, subject, textContent, htmlContent);
  } catch (apiErr) {
    console.warn(`[EMAIL SERVICE] Brevo HTTP API failed (${apiErr.message}). Falling back to SMTP...`);
  }

  // Fallback to Nodemailer SMTP
  try {
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: `"Dating App Security" <${SENDER_EMAIL}>`,
      to: toEmail,
      subject,
      text: textContent,
      html: htmlContent,
    });
    console.log(`[EMAIL SERVICE] SMTP Password reset OTP sent successfully to ${toEmail}. Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[EMAIL SERVICE] Error sending password reset OTP to ${toEmail}:`, error.message);
    throw error;
  }
};

module.exports = {
  sendMobileVerificationOtp,
  sendPasswordResetOtp,
};
