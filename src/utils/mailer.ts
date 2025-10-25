import nodemailer, { Transporter, SendMailOptions } from "nodemailer";
import {
  getEmailTemplate,
  EmailTemplateParams,
} from "../template/actionNotificationEmailTemplate";

export interface EmailOptions extends Partial<SendMailOptions> {
  to: string;
  subject: string;
  cc?: string | string[]; // Add CC support
  templateParams?: EmailTemplateParams;
}



export class Mailer {
  private transporter: Transporter;
  private config: MailerConfig;

  constructor(config: MailerConfig) {
    this.config = config;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    const { to, subject, cc, templateParams, ...mailOptions } = options;

    const html = mailOptions.html || getEmailTemplate(templateParams);

    try {
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to,
        cc, // Add CC to mail options
        subject,
        text:
          mailOptions.text || "Please enable HTML to view this email content.",
        html,
        ...mailOptions,
      });

      console.log("Message sent: %s", info.messageId);
      if (cc) {
        console.log("CC recipients:", Array.isArray(cc) ? cc.join(', ') : cc);
      }
    } catch (error) {
      console.error("Error sending email:", error);
      throw error;
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      console.log("Server is ready to take our messages");
      return true;
    } catch (error) {
      console.error("Connection verification failed:", error);
      return false;
    }
  }
}
export interface MailerConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  tls?: {
    ciphers?: string;
  };
}

export const mailerConfig: MailerConfig = {
  host: "smtp.office365.com",
  port: 587,
  secure: false, // use STARTTLS
  auth: {
    user: "info@alghazalgroup.com", // your Office365 email
    pass: "ftftxxppxyjppggf", // 🔑 your Office365 App Password
  },
  // host: "smtp.gmail.com",
  // port: parseInt(process.env.SMTP_PORT || '587'),
  // secure: false,
  // auth: {
  //   user: "ajmalshahan23@gmail.com",
  //   pass: "wgmt bvtx wllu nzuz",
  // },
  from: '"Alghazal" <info@alghazalgroup.com>', // must match user
};

// ✅ Singleton instance
export const mailer = new Mailer(mailerConfig);
