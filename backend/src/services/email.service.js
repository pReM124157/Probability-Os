import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

export async function sendEmailAlert(subject, text) {
  return sendEmail({ subject, text });
}

export async function sendEmail({ subject, text }) {
  try {
    console.log("📨 EMAIL SEND STARTED TO:", process.env.TARGET_EMAIL);
    
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.TARGET_EMAIL,
      subject,
      text
    });

    console.log("✅ EMAIL SENT SUCCESSFULLY:", info.response);
  } catch (error) {
    console.error("❌ EMAIL ERROR:", error);
    console.error("Check if EMAIL_USER and EMAIL_PASS (App Password) are correct.");
  }
}
