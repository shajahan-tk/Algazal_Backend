"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mailer = exports.mailerConfig = exports.Mailer = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const actionNotificationEmailTemplate_1 = require("../template/actionNotificationEmailTemplate");
class Mailer {
    transporter;
    config;
    constructor(config) {
        this.config = config;
        this.transporter = nodemailer_1.default.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: config.auth,
        });
    }
    async sendEmail(options) {
        const { to, subject, templateParams, ...mailOptions } = options;
        const html = mailOptions.html || (0, actionNotificationEmailTemplate_1.getEmailTemplate)(templateParams);
        try {
            const info = await this.transporter.sendMail({
                from: this.config.from,
                to,
                subject,
                text: mailOptions.text || "Please enable HTML to view this email content.",
                html,
                ...mailOptions,
            });
            console.log("Message sent: %s", info.messageId);
        }
        catch (error) {
            console.error("Error sending email:", error);
            throw error;
        }
    }
    async verifyConnection() {
        try {
            await this.transporter.verify();
            console.log("Server is ready to take our messages");
            return true;
        }
        catch (error) {
            console.error("Connection verification failed:", error);
            return false;
        }
    }
}
exports.Mailer = Mailer;
exports.mailerConfig = {
    host: "host",
    port: 587,
    secure: false, // STARTTLS
    auth: {
        user: "mail", // full email
        pass: "passs", // same password as in Outlook
    },
    from: `"ALGHAZAL ALABYAD TECHNICAL SERVICES" <info@alghazalgroup.com>`,
    tls: {
        ciphers: "SSLv3",
    },
};
// Singletonghazalgroup.com instance (optional)
exports.mailer = new Mailer(exports.mailerConfig);
//# sourceMappingURL=mailer.js.map