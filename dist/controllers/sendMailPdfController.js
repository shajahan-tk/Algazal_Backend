"use strict";
// Add this to your quotationController.ts file
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendQuotationEmail = void 0;
const quotationModel_1 = require("../models/quotationModel");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const asyncHandler_1 = require("../utils/asyncHandler");
const mailer_1 = require("../utils/mailer");
const puppeteer_1 = __importDefault(require("puppeteer"));
exports.sendQuotationEmail = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const quotation = await quotationModel_1.Quotation.findById(id)
        .populate({
        path: "project",
        select: "projectName client siteAddress location building apartmentNumber",
        populate: {
            path: "client",
            select: "clientName clientAddress mobileNumber telephoneNumber email",
        },
    })
        .populate("preparedBy", "firstName lastName phoneNumbers");
    if (!quotation)
        throw new apiHandlerHelpers_1.ApiError(404, "Quotation not found");
    if (!quotation.project || typeof quotation.project !== "object" || !("client" in quotation.project)) {
        throw new apiHandlerHelpers_1.ApiError(400, "Client information not found");
    }
    const client = quotation.project.client;
    const preparedBy = quotation.preparedBy;
    const project = quotation.project;
    // Check if client has email
    if (!client.email) {
        throw new apiHandlerHelpers_1.ApiError(400, "Client email not found");
    }
    // Generate PDF first
    const pdfBuffer = await generateQuotationPdfBuffer(quotation, client, preparedBy, project);
    // Create email HTML content using the template
    const emailHtmlContent = createQuotationEmailTemplate(quotation.quotationNumber, client.clientName, `${preparedBy.firstName} ${preparedBy.lastName}`);
    try {
        // Send email with PDF attachment
        await mailer_1.mailer.sendEmail({
            to: client.email,
            subject: `Quotation ${quotation.quotationNumber} - ${project.projectName}`,
            html: emailHtmlContent,
            attachments: [
                {
                    filename: `Quotation-${quotation.quotationNumber}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        });
        // Update project status to quotation_sent if not already
        res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, null, "Quotation email sent successfully"));
    }
    catch (error) {
        console.error("Error sending quotation email:", error);
        throw new apiHandlerHelpers_1.ApiError(500, "Failed to send quotation email");
    }
});
// Helper function to generate PDF buffer (extracted from existing PDF generation code)
const generateQuotationPdfBuffer = async (quotation, client, preparedBy, project) => {
    const site = `${project.location} ${project.building} ${project.apartmentNumber}`;
    // Calculate totals
    const subtotal = quotation.items.reduce((sum, item) => sum + item.totalPrice, 0);
    const vatAmount = subtotal * (quotation.vatPercentage / 100);
    const netAmount = subtotal + vatAmount;
    const formatDate = (date) => {
        return date ? new Date(date).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        }) : "";
    };
    const getDaysRemaining = (validUntil) => {
        if (!validUntil)
            return "N/A";
        const today = new Date();
        const validDate = new Date(validUntil);
        const timeDiff = validDate.getTime() - today.getTime();
        const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));
        return daysRemaining > 0 ? `${daysRemaining} days` : "Expired";
    };
    // Use the same HTML content from your existing PDF generation
    let htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <style type="text/css">
   @page {
  size: A4;
  margin: 1cm;
}
body {
  font-family: 'Arial', sans-serif;
  font-size: 10pt;
  line-height: 1.4;
  color: #333;
  margin: 0;
  padding: 0;
}

.container {
  display: block;
}

.content {
  margin-bottom: 20px;
}

.header {
  display: flex;
  align-items: flex-start;
  margin-bottom: 15px;
  gap: 15px;
}

.logo {
  height: 50px;
  width: auto;
}

.header-content {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
}

.document-title {
  font-size: 14pt;
  font-weight: bold;
  margin: 0;
  color: #000;
  padding-top: 8px;
}

.client-info-container {
  display: flex;
  margin-bottom: 10px;
  gap: 20px;
}

.client-info {
  flex: 1;
  padding: 10px;
  border: 1px solid #eee;
  border-radius: 4px;
}

.quotation-info {
  width: 250px;
}

.quotation-details {
  width: 100%;
  border-collapse: collapse;
}

.quotation-details tr:not(:last-child) {
  border-bottom: 1px solid #eee;
}

.quotation-details td {
  padding: 8px 10px;
  vertical-align: top;
}

.quotation-details td:first-child {
  font-weight: bold;
  width: 40%;
  color: #555;
}

.section {
  margin-bottom: 15px;
  page-break-inside: avoid;
}

.section-title {
  font-size: 11pt;
  font-weight: bold;
  padding: 5px 0;
  margin: 10px 0 5px 0;
  border-bottom: 1px solid #ddd;
}

.terms-prepared-section {
  margin-top: 15px;
  page-break-inside: avoid;
}

.terms-prepared-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 5px;
  border-bottom: 1px solid #ddd;
  margin-bottom: 10px;
}

.terms-title, .prepared-title {
  font-size: 11pt;
  font-weight: bold;
  margin: 0;
  color: #333;
}

.terms-prepared-content {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.terms-content {
  flex: 1;
}

.prepared-content {
  width: 250px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 15px;
  page-break-inside: avoid;
}

th {
  background-color: #94d7f4;
  color: #000;
  font-weight: bold;
  padding: 6px 8px;
  text-align: left;
  border: 1px solid #ddd;
}

td {
  padding: 6px 8px;
  border: 1px solid #ddd;
  vertical-align: top;
}

.amount-summary {
  margin-top: 10px;
  width: 100%;
  text-align: right;
}

.amount-summary-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 5px;
}

.amount-label {
  width: 150px;
  font-weight: bold;
  text-align: right;
  padding-right: 10px;
}

.amount-value {
  width: 100px;
  text-align: right;
}

.net-amount-row {
  display: flex;
  justify-content: flex-end;
  background-color: #94d7f4;
  color: #000;
  font-weight: bold;
  font-size: 11pt;
  margin-top: 5px;
  padding: 5px 0;
  border-top: 1px solid #333;
}

.terms-box {
  border: 1px solid #000;
  padding: 10px;
  width: 100%;
  box-sizing: border-box;
}

.prepared-by-name {
  font-weight: bold;
  margin-top: 5px;
}

.prepared-by-title {
  font-size: 9pt;
  color: #777;
  margin-top: 5px;
}

.tagline {
  text-align: center;
  font-weight: bold;
  font-size: 12pt;
  margin: 20px 0 10px 0;
  color: #333;
  border-top: 2px solid #ddd;
  padding-top: 15px;
  page-break-before: avoid;
}

.footer {
  font-size: 9pt;
  color: #777;
  text-align: center;
  margin-top: 10px;
  page-break-inside: avoid;
  page-break-before: avoid;
}

.text-center {
  text-align: center;
}

.text-right {
  text-align: right;
}

p {
  margin: 5px 0;
}
  </style>
</head>
<body>
  <div class="container">
    <div class="content">
      <div class="header">
        <img class="logo" src="https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/sample-spmc/logo+(1).png" alt="Company Logo">
        <div class="header-content">
          <div class="document-title">QUOTE</div>
        </div>
      </div>

      <div class="client-info-container">
        <div class="client-info">
          <p><strong>CLIENT:</strong> ${client.clientName || "N/A"}</p>
          <p><strong>ADRESS:</strong> ${client.clientAddress || "N/A"}</p>
          <p><strong>CONTACT:</strong> ${client.mobileNumber || client.telephoneNumber || "N/A"}</p>
          <p><strong>EMAIL:</strong> ${client.email || "N/A"}</p>
          <p><strong>SITE:</strong> ${site}</p>
          <p><strong>SUBJECT:</strong> ${project.projectName || "N/A"}</p>
        </div>

        <div class="quotation-info">
          <table class="quotation-details">
            <tr>
              <td>Quotation #:</td>
              <td>${quotation.quotationNumber}</td>
            </tr>
            <tr>
              <td>Date:</td>
              <td>${formatDate(quotation.date)}</td>
            </tr>
            <tr>
              <td>Valid Until:</td>
              <td>${getDaysRemaining(quotation.validUntil)}</td>
            </tr>
          </table>
        </div>
      </div>

      <div class="section">
        <div class="section-title">ITEMS</div>
        <table>
          <thead>
            <tr>
              <th width="5%">No.</th>
              <th width="35%">Description</th>
              <th width="10%">UOM</th>
              <th width="15%">Image</th>
              <th width="10%">Qty</th>
              <th width="15%">Unit Price (AED)</th>
              <th width="10%" class="text-right">Total (AED)</th>
            </tr>
          </thead>
          <tbody>
            ${quotation.items.map((item, index) => `
              <tr>
                <td class="text-center">${index + 1}</td>
                <td>${item.description}</td>
                <td class="text-center">${item.uom || "NOS"}</td>
                <td class="text-center" style="padding: 5px;">
                  ${item.image?.url ? `<img src="${item.image.url}" style="width: 100%; height: auto; max-height: 80px; object-fit: contain;"/>` : ""}
                </td>
                <td class="text-center">${item.quantity.toFixed(2)}</td>
                <td class="text-right">${item.unitPrice.toFixed(2)}</td>
                <td class="text-right">${item.totalPrice.toFixed(2)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="amount-summary">
          <div class="amount-summary-row">
            <div class="amount-label">SUBTOTAL:</div>
            <div class="amount-value">${subtotal.toFixed(2)} AED</div>
          </div>
          <div class="amount-summary-row">
            <div class="amount-label">VAT ${quotation.vatPercentage}%:</div>
            <div class="amount-value">${vatAmount.toFixed(2)} AED</div>
          </div>
          <div class="net-amount-row">
            <div class="amount-label">NET AMOUNT:</div>
            <div class="amount-value">${netAmount.toFixed(2)} AED</div>
          </div>
        </div>
      </div>

      ${quotation.termsAndConditions.length > 0 ? `
      <div class="terms-prepared-section">
        <div class="terms-prepared-header">
          <div class="terms-title">TERMS & CONDITIONS</div>
          <div class="prepared-title">PREPARED BY</div>
        </div>
        <div class="terms-prepared-content">
          <div class="terms-content">
            <div class="terms-box">
              <ol>
                ${quotation.termsAndConditions.map((term) => `<li>${term}</li>`).join("")}
              </ol>
            </div>
          </div>
          <div class="prepared-content">
            <div class="prepared-by-name">${preparedBy?.firstName || "N/A"} ${preparedBy?.lastName || ""}</div>
            ${preparedBy?.phoneNumbers?.length ? `
            <div class="prepared-by-title">Phone: ${preparedBy.phoneNumbers.join(", ")}</div>
            ` : ''}
          </div>
        </div>
      </div>
      ` : `
      <div class="section">
        <div class="section-title">PREPARED BY</div>
        <div class="prepared-by-name" >${preparedBy?.firstName || "N/A"} ${preparedBy?.lastName || ""}</div>
        ${preparedBy?.phoneNumbers?.length ? `
        <div class="prepared-by-title">Phone: ${preparedBy.phoneNumbers.join(", ")}</div>
        ` : ''}
      </div>
      `}
    </div>

    <div class="tagline">We work U Relax</div>
    <div class="footer">
      <p><strong>AL GHAZAL AL ABYAD TECHNICAL SERVICES</strong></p>
      <p>Office No:04, R09-France Cluster, International City-Dubai | P.O.Box:262760, Dubai-U.A.E</p>
      <p>Tel: 044102555 | <a href="http://www.alghazalgroup.com/">www.alghazalgroup.com</a></p>
      <p>Generated on ${formatDate(new Date())}</p>
    </div>
  </div>
</body>
</html>
`;
    const browser = await puppeteer_1.default.launch({
        headless: "shell",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, {
            waitUntil: ["load", "networkidle0", "domcontentloaded"],
            timeout: 30000,
        });
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "1cm",
                right: "1cm",
                bottom: "1cm",
                left: "1cm",
            },
        });
        return pdfBuffer;
    }
    finally {
        await browser.close();
    }
};
// Helper function to create email HTML template
const createQuotationEmailTemplate = (quotationNumber, clientName, senderName) => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quote Template</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f0f0f0;
        }
        
        .quote-container {
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .quote-header {
            background: linear-gradient(135deg, #4a90e2, #357abd);
            color: white;
            text-align: center;
            padding: 15px;
            font-size: 18px;
            font-weight: bold;
        }
        
        .quote-body {
            padding: 30px;
            line-height: 1.6;
            color: #333;
        }
        
        .greeting {
            margin-bottom: 20px;
        }
        
        .client-name {
            background-color: #ffeb3b;
            padding: 2px 4px;
            font-weight: bold;
        }
        
        .content-line {
            margin-bottom: 15px;
        }
        
        .signature {
            margin-top: 30px;
        }
        
        .sender-name {
            background-color: #ffeb3b;
            padding: 2px 4px;
            font-weight: bold;
        }
        
        .company-name {
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="quote-container">
        <div class="quote-header">
            Quote #${quotationNumber}
        </div>
        
        <div class="quote-body">
            <div class="greeting">
                Dear <span class="client-name">${clientName}</span>
            </div>
            
            <div class="content-line">
                Please Find the Attached Proposal for your reference.
            </div>
            
            <div class="content-line">
                We are waiting for your positive response.
            </div>
            
            <div class="signature">
                <div>Regards,</div>
                <div><span class="sender-name">${senderName}</span></div>
                <div class="company-name">AL GHAZAL AL ABYAD TECHNICAL SERVICES</div>
            </div>
        </div>
    </div>
</body>
</html>`;
};
//# sourceMappingURL=sendMailPdfController.js.map