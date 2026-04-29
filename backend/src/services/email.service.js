import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

export async function sendEmailAlert(subject, text) {
  return sendEmail({ subject, text });
}

export async function sendEmail({ subject, text }) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.TARGET_EMAIL,
      subject,
      text
    });
    console.log("✅ Email alert sent successfully");
  } catch (error) {
    console.log("Email Service Error:", error.message);
  }
}
