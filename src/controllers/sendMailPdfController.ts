import { IClient } from "../models/clientModel";
import { IProject, Project } from "../models/projectModel";
import { Quotation } from "../models/quotationModel";
import { IUser } from "../models/userModel";
import { ApiError, ApiResponse } from "../utils/apiHandlerHelpers";
import { asyncHandler } from "../utils/asyncHandler";
import { mailer } from "../utils/mailer";
import { Request, Response } from "express";
import puppeteer from "puppeteer";
import { WorkCompletion } from "../models/workCompletionModel";
import { LPO } from "../models/lpoModel";


export const sendQuotationEmail = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { cc } = req.body;

    const quotation = await Quotation.findById(id)
      .populate<{ project: IProject & { client: IClient } }>({
        path: "project",
        select: "projectName client siteAddress location building apartmentNumber attention",
        populate: {
          path: "client",
          select: "clientName clientAddress mobileNumber telephoneNumber email",
        },
      })
      .populate<{ preparedBy: IUser }>(
        "preparedBy",
        "firstName lastName phoneNumbers"
      );

    if (!quotation) throw new ApiError(404, "Quotation not found");

    if (!quotation.project || typeof quotation.project !== "object" || !("client" in quotation.project)) {
      throw new ApiError(400, "Client information not found");
    }

    const client = quotation.project.client as IClient;
    const preparedBy = quotation.preparedBy as IUser;
    const project = quotation.project;

    if (!client.email) {
      throw new ApiError(400, "Client email not found");
    }

    if (cc && Array.isArray(cc) && cc.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = cc.filter((email: string) => !emailRegex.test(email));
      
      if (invalidEmails.length > 0) {
        throw new ApiError(400, `Invalid CC email addresses: ${invalidEmails.join(', ')}`);
      }
    }

    const pdfBuffer = await generateQuotationPdfBuffer(quotation, client, preparedBy, project);

    const emailHtmlContent = createQuotationEmailTemplate(
      quotation,
      client,
      preparedBy,
      project
    );

    try {
      await mailer.sendEmail({
        to: client.email,
        cc: cc && cc.length > 0 ? cc : undefined,
        subject: `Quotation ${quotation.quotationNumber} - ${project.projectName}`,
        html: emailHtmlContent,
        attachments: [
          {
            filename: `Quotation-${quotation.quotationNumber}.pdf`,
            content: pdfBuffer as any,
            contentType: 'application/pdf'
          }
        ]
      });

      const ccMessage = cc && cc.length > 0 ? ` with CC to ${cc.length} recipient(s)` : '';
      res.status(200).json(
        new ApiResponse(200, null, `Quotation email sent successfully${ccMessage}`)
      );
    } catch (error) {
      console.error("Error sending quotation email:", error);
      throw new ApiError(500, "Failed to send quotation email");
    }
  }
);

const generateQuotationPdfBuffer = async (
  quotation: any,
  client: IClient,
  preparedBy: IUser,
  project: IProject
) => {
  const site = `${project.location} ${project.building} ${project.apartmentNumber}`;
  
  const subtotal = quotation.items.reduce((sum: number, item: any) => sum + item.totalPrice, 0);
  const vatAmount = subtotal * (quotation.vatPercentage / 100);
  const netAmount = subtotal + vatAmount;

  const formatDate = (date: Date) => {
    return date ? new Date(date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) : "";
  };
  
  const getDaysRemaining = (validUntil: Date) => {
    if (!validUntil) return "N/A";
    const today = new Date();
    const validDate = new Date(validUntil);
    const timeDiff = validDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));
    return daysRemaining > 0 ? `${daysRemaining} days` : "Expired";
  };

  const cleanDescription = (description: string) => {
    return description.replace(/\n\n+/g, '\n').trim();
  };

  let htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <style type="text/css">
    @page {
      size: A4;
      margin: 0.5cm;
    }
    
    body {
      font-family: 'Arial', sans-serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #333;
      margin: 0;
      padding: 0;
    }

    .container {
      display: block;
      width: 100%;
      max-width: 100%;
    }

    .content {
      margin-bottom: 15px;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 15px;
      gap: 20px;
      page-break-after: avoid;
      padding: 10px 0;
      border-bottom: 3px solid #94d7f4;
      position: relative;
    }

    .logo {
      height: 50px;
      width: auto;
      max-width: 150px;
      object-fit: contain;
      position: absolute;
      left: 0;
      top:-12px;
    }

    .company-names {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      flex-grow: 1;
    }

    .company-name-arabic {
      font-size: 20pt;
      font-weight: bold;
      color: #1a1a1a;
      line-height: 1.3;
      direction: rtl;
      unicode-bidi: bidi-override;
      letter-spacing: 0;
      margin-bottom: 5px;
    }

    .company-name-english {
      font-size: 10pt;
      font-weight: bold;
      color: #1a1a1a;
      line-height: 1.3;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .client-info-container {
      display: flex;
      margin-bottom: 8px;
      gap: 15px;
      page-break-after: avoid;
    }

    .client-info {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 9.5pt;
      background-color: #f8f9fa;
    }

    .client-info p {
      margin: 4px 0;
      line-height: 1.3;
    }

    .client-info strong {
      font-weight: 600;
      color: #2c3e50;
    }

    .quotation-info {
      width: 220px;
    }

    .quotation-details {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
    }

    .quotation-details tr:not(:last-child) {
      border-bottom: 1px solid #eee;
    }

    .quotation-details td {
      padding: 6px 8px;
      vertical-align: top;
    }

    .quotation-details td:first-child {
      font-weight: bold;
      width: 40%;
      color: #2c3e50;
    }

    .subject-section {
      margin: 8px 0;
      padding: 8px 10px;
      background-color: #f8f9fa;
      border-radius: 4px;
      page-break-after: avoid;
    }

    .subject-title {
      font-weight: bold;
      font-size: 10.5pt;
      margin-bottom: 4px;
      color: #2c3e50;
    }

    .subject-content {
      font-size: 10pt;
      color: #333;
      font-weight: 500;
    }

    .section {
      margin-bottom: 12px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 11pt;
      font-weight: bold;
      padding: 4px 0;
      margin: 8px 0 6px 0;
      border-bottom: 2px solid #94d7f4;
      page-break-after: avoid;
      color: #2c3e50;
    }

    .table-container {
      page-break-inside: auto;
      overflow: visible;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      page-break-inside: auto;
      font-size: 9.5pt;
      table-layout: fixed;
    }

    thead {
      display: table-header-group;
    }

    tbody {
      display: table-row-group;
    }

    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    th, td {
      page-break-inside: avoid;
      page-break-before: auto;
    }

    th {
      background-color: #94d7f4;
      color: #000;
      font-weight: bold;
      padding: 5px 6px;
      text-align: left;
      border: 1px solid #ddd;
      font-size: 9.5pt;
    }

    td {
      padding: 5px 6px;
      border: 1px solid #ddd;
      vertical-align: top;
      font-size: 9.5pt;
    }

    .col-desc {
      white-space: pre-wrap;
    }

    .col-no { width: 5%; }
    .col-desc { width: 45%; }
    .col-uom { width: 10%; }
    .col-qty { width: 10%; }
    .col-unit { width: 15%; }
    .col-total { width: 15%; }

    .amount-summary {
      margin-top: 8px;
      width: 100%;
      text-align: right;
      page-break-before: avoid;
      font-size: 10pt;
    }

    .amount-summary-row {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 4px;
    }

    .amount-label {
      width: 120px;
      font-weight: bold;
      text-align: right;
      padding-right: 10px;
      font-size: 9.5pt;
    }

    .amount-value {
      width: 90px;
      text-align: right;
      font-size: 9.5pt;
    }

    .net-amount-row {
      display: flex;
      justify-content: flex-end;
      background-color: #94d7f4;
      color: #000;
      font-weight: bold;
      font-size: 10pt;
      margin-top: 4px;
      padding: 4px 0;
      border-top: 2px solid #333;
    }

    .images-section {
      margin-top: 10px;
      page-break-inside: avoid;
    }

    .images-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 4px;
    }

    .image-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      page-break-inside: avoid;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 8px;
      background: #fafafa;
      min-height: 0;
    }

    .image-container {
      width: 100%;
      height: 140px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      margin-bottom: 6px;
      background: #fff;
      border-radius: 4px;
    }

    .image-container img {
      max-height: 100%;
      max-width: 100%;
      object-fit: contain;
    }

    .image-title {
      font-size: 8.5pt;
      font-weight: 600;
      text-align: center;
      color: #2c3e50;
      line-height: 1.2;
      margin: 0;
      word-break: break-word;
      max-height: 32px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .image-description {
      font-size: 7.5pt;
      text-align: center;
      color: #666;
      line-height: 1.2;
      margin: 2px 0 0 0;
      max-height: 20px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .terms-prepared-section {
      margin-top: 12px;
      page-break-inside: avoid;
    }

    .terms-prepared-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 4px;
      border-bottom: 2px solid #94d7f4;
      margin-bottom: 8px;
      page-break-after: avoid;
    }

    .terms-title, .prepared-title {
      font-size: 10pt;
      font-weight: bold;
      margin: 0;
      color: #2c3e50;
    }

    .terms-prepared-content {
      display: flex;
      gap: 15px;
      align-items: flex-start;
    }

    .terms-content {
      flex: 1;
    }

    .prepared-content {
      width: 200px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      font-size: 9.5pt;
    }

    .terms-box {
      border: 1px solid #000;
      padding: 8px 10px;
      width: 100%;
      box-sizing: border-box;
      font-size: 9.5pt;
      line-height: 1.4;
    }

    .terms-box ol {
      margin: 0;
      padding-left: 15px;
    }

    .terms-box li {
      margin-bottom: 4px;
    }

    .prepared-by-name {
      font-weight: bold;
      margin-top: 4px;
      font-size: 10pt;
      color: #2c3e50;
    }

    .prepared-by-title {
      font-size: 9pt;
      color: #555;
      margin-top: 2px;
    }

    .tagline {
      text-align: center;
      font-weight: bold;
      font-size: 11pt;
      margin: 15px 0 8px 0;
      color: #2c3e50;
      border-top: 2px solid #ddd;
      padding-top: 8px;
      page-break-before: avoid;
    }

    .footer {
      font-size: 8.5pt;
      color: #555;
      text-align: center;
      margin-top: 8px;
      page-break-inside: avoid;
      line-height: 1.3;
    }

    .footer p {
      margin: 4px 0;
    }

    .footer strong {
      color: #2c3e50;
    }

    .text-center {
      text-align: center;
    }

    .text-right {
      text-align: right;
    }

    p {
      margin: 4px 0;
      line-height: 1.3;
    }

    strong {
      font-weight: 600;
    }

    @media print {
      thead { 
        display: table-header-group; 
      }
      tfoot { 
        display: table-footer-group; 
      }
      
      table {
        page-break-inside: auto;
      }
      
      tr {
        break-inside: avoid;
        break-after: auto;
      }

      .subject-section {
        page-break-after: avoid;
        page-break-inside: avoid;
      }

      .items-section {
        page-break-before: auto;
      }

      body {
        font-size: 10pt;
        margin: 0;
        padding: 0;
      }

      .container {
        margin: 0;
        padding: 0;
      }

      .image-item {
        page-break-inside: avoid;
      }

      .images-grid {
        break-inside: avoid;
      }
    }

    .page-break {
      page-break-before: always;
    }

    .header-section {
      page-break-after: avoid;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="content">
      <div class="header-section">
        <div class="header">
          <img class="logo" src="https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/sample-spmc/logo+(1).png" alt="Company Logo">
          <div class="company-names">
            <div class="company-name-arabic">الغزال الأبيض للخدمات الفنية</div>
            <div class="company-name-english">AL GHAZAL AL ABYAD TECHNICAL SERVICES</div>
          </div>
        </div>

        <div class="client-info-container">
          <div class="client-info">
            <p><strong>CLIENT:</strong> ${client.clientName || "N/A"}</p>
            <p><strong>ADDRESS:</strong> ${client.clientAddress || "N/A"}</p>
            <p><strong>CONTACT:</strong> ${client.mobileNumber || client.telephoneNumber || "N/A"}</p>
            <p><strong>EMAIL:</strong> ${client.email || "N/A"}</p>
            <p><strong>SITE:</strong> ${site}</p>
            <p><strong>ATTENTION:</strong> ${project.attention || "N/A"}</p>
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
                <td>${formatDate(quotation.validUntil)} (${getDaysRemaining(quotation.validUntil)})</td>
              </tr>
            </table>
          </div>
        </div>

        <div class="subject-section">
          <div class="subject-title">SUBJECT</div>
          <div class="subject-content">${project.projectName || "N/A"}</div>
        </div>
      </div>

      <div class="section items-section">
        <div class="section-title">ITEMS</div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th class="col-no">No.</th>
                <th class="col-desc">Description</th>
                <th class="col-uom">UOM</th>
                <th class="col-qty">Qty</th>
                <th class="col-unit">Unit Price (AED)</th>
                <th class="col-total text-right">Total (AED)</th>
              </tr>
            </thead>
            <tbody>
              ${quotation.items.map((item: any, index: number) => `
                <tr>
                  <td class="text-center col-no">${index + 1}</td>
                  <td class="col-desc">${cleanDescription(item.description)}</td>
                  <td class="text-center col-uom">${item.uom || "NOS"}</td>
                  <td class="text-center col-qty">${item.quantity.toFixed(2)}</td>
                  <td class="text-right col-unit">${item.unitPrice.toFixed(2)}</td>
                  <td class="text-right col-total">${item.totalPrice.toFixed(2)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

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

      ${quotation.images && quotation.images.length > 0 ? `
      <div class="section images-section">
        <div class="section-title">QUOTATION IMAGES</div>
        <div class="images-grid">
          ${quotation.images.map((image: any) => `
            <div class="image-item">
              <div class="image-container">
                <img src="${image.imageUrl}" alt="${image.title}" />
              </div>
              <div class="image-title">${image.title}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${quotation.termsAndConditions && quotation.termsAndConditions.length > 0 ? `
      <div class="terms-prepared-section">
        <div class="terms-prepared-header">
          <div class="terms-title">TERMS & CONDITIONS</div>
          <div class="prepared-title">PREPARED BY</div>
        </div>
        <div class="terms-prepared-content">
          <div class="terms-content">
            <div class="terms-box">
              <ol>
                ${quotation.termsAndConditions.map((term: string) => `<li>${term}</li>`).join("")}
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
        <div class="prepared-content">
          <div class="prepared-by-name">${preparedBy?.firstName || "N/A"} ${preparedBy?.lastName || ""}</div>
          ${preparedBy?.phoneNumbers?.length ? `
          <div class="prepared-by-title">Phone: ${preparedBy.phoneNumbers.join(", ")}</div>
          ` : ''}
        </div>
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

  const browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({ width: 1200, height: 1600 });

    await page.setContent(htmlContent, {
      waitUntil: ["load", "networkidle0", "domcontentloaded"],
      timeout: 30000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0.5cm",
        right: "0.5cm",
        bottom: "0.5cm",
        left: "0.5cm",
      },
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });

    return pdfBuffer;
  } catch (error) {
    console.error("PDF generation error:", error);
    throw new ApiError(500, "Failed to generate PDF");
  } finally {
    await browser.close();
  }
};

const createQuotationEmailTemplate = (
  quotation: any,
  client: IClient,
  preparedBy: IUser,
  project: IProject
): string => {
  const site = `${project.location} ${project.building} ${project.apartmentNumber}`;
  
  const subtotal = quotation.items.reduce((sum: number, item: any) => sum + item.totalPrice, 0);
  const vatAmount = subtotal * (quotation.vatPercentage / 100);
  const netAmount = subtotal + vatAmount;

  const formatDate = (date: Date) => {
    return date ? new Date(date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) : "";
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quotation ${quotation.quotationNumber}</title>
  <style>
    body {
      font-family: 'Arial', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 20px;
      background-color: #f9f9f9;
    }
    
    .email-container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    
    .email-header {
      background: linear-gradient(135deg, #4a90e2, #357abd);
      color: white;
      padding: 20px;
      text-align: center;
    }
    
    .email-body {
      padding: 30px;
    }
    
    .greeting {
      margin-bottom: 20px;
      font-size: 16px;
    }
    
    .client-name {
    
      padding: 2px 6px;
      font-weight: bold;
      color: #333;
    }
    
    .content-section {
      margin-bottom: 25px;
    }
    
    .content-line {
      margin-bottom: 12px;
      font-size: 14px;
    }
    
    .attachment-notice {
      background: #e3f2fd;
      border-left: 4px solid #2196f3;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }
    
    .signature {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #e0e0e0;
    }
    
    .sender-name {
      font-weight: bold;
      font-size: 16px;
      color: #2c3e50;
    }
    
    .company-name {
      font-weight: bold;
      color: #4a90e2;
      margin-top: 5px;
    }
    
    .quotation-details {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 6px;
      margin: 20px 0;
    }
    
    .detail-row {
      display: flex;
      margin-bottom: 8px;
    }
    
    .detail-label {
      font-weight: bold;
      min-width: 120px;
      color: #2c3e50;
    }
    
    .footer {
      background: #2c3e50;
      color: white;
      padding: 20px;
      text-align: center;
      font-size: 12px;
    }
    
    .footer a {
      color: #4a90e2;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>Quotation #${quotation.quotationNumber}</h1>
      <p>${project.projectName}</p>
    </div>
    
    <div class="email-body">
      <div class="greeting">
        Dear <span class="client-name">${client.clientName}</span>,
      </div>
      
      <div class="content-section">
        <div class="content-line">
          We are pleased to submit our quotation for your project. Please find the detailed quotation attached with this email.
        </div>
        
        <div class="quotation-details">
          <div class="detail-row">
            <span class="detail-label">Project:</span>
            <span>${project.projectName}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Quotation Date:</span>
            <span>${formatDate(quotation.date)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Valid Until:</span>
            <span>${formatDate(quotation.validUntil)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Net Amount:</span>
            <span><strong>AED ${netAmount.toFixed(2)}</strong></span>
          </div>
        </div>
        
        <div class="content-line">
          The attached PDF contains complete details including:
        </div>
        <ul>
          <li>Itemized pricing with descriptions</li>
          <li>Terms and conditions</li>
          <li>Project scope and specifications</li>
          ${quotation.images && quotation.images.length > 0 ? '<li>Reference images</li>' : ''}
        </ul>
      </div>
      
      <div class="attachment-notice">
        <strong>📎 Attachment:</strong> Quotation-${quotation.quotationNumber}.pdf
      </div>
      
      <div class="content-line">
        We are confident that our proposal meets your requirements and look forward to the opportunity to work with you.
      </div>
      
      <div class="content-line">
        Please don't hesitate to contact us if you have any questions or require further clarification.
      </div>
      
      <div class="signature">
        <div>Best regards,</div>
        <div class="sender-name">${preparedBy.firstName} ${preparedBy.lastName}</div>
        <div class="company-name">AL GHAZAL AL ABYAD TECHNICAL SERVICES</div>
        ${preparedBy.phoneNumbers?.length ? `
        <div style="margin-top: 8px;">
          <strong>Phone:</strong> ${preparedBy.phoneNumbers.join(", ")}
        </div>
        ` : ''}
      </div>
    </div>
    
    <div class="footer">
      <p><strong>AL GHAZAL AL ABYAD TECHNICAL SERVICES</strong></p>
      <p>Office No:04, R09-France Cluster, International City-Dubai | P.O.Box:262760, Dubai-U.A.E</p>
      <p>Tel: 044102555 | <a href="http://www.alghazalgroup.com/">www.alghazalgroup.com</a></p>
    </div>
  </div>
</body>
</html>`;
};




export const sendWorkCompletionEmail = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { cc } = req.body; // Extract CC from request body

    // Get project with populated data
    const project = await Project.findById(projectId)
      .populate<{ client: IClient }>("client", "clientName clientAddress mobileNumber telephoneNumber email")
      .populate<{ assignedTo: IUser }>("assignedTo", "firstName lastName signatureImage")
      .populate<{ createdBy: IUser }>("createdBy", "firstName lastName signatureImage");

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    const client = project.client as IClient;
    
    // Check if client has email
    if (!client.email) {
      throw new ApiError(400, "Client email not found");
    }

    // Validate CC emails if provided
    if (cc && Array.isArray(cc) && cc.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = cc.filter((email: string) => !emailRegex.test(email));
      
      if (invalidEmails.length > 0) {
        throw new ApiError(400, `Invalid CC email addresses: ${invalidEmails.join(', ')}`);
      }
    }

    // Get work completion data
    const workCompletion = await WorkCompletion.findOne({ project: projectId })
      .populate("createdBy", "firstName lastName signatureImage");

    const lpo = await LPO.findOne({ project: projectId })
      .sort({ createdAt: -1 })
      .limit(1);

    // Generate PDF first
    const pdfBuffer = await generateWorkCompletionPdfBuffer(
      project,
      client,
      workCompletion,
      lpo
    );

    // Create email HTML content
    const emailHtmlContent = createWorkCompletionEmailTemplate(
      project,
      client,
      workCompletion
    );

    try {
      // Send email with PDF attachment and CC
      await mailer.sendEmail({
        to: client.email,
        cc: cc && cc.length > 0 ? cc : undefined,
        subject: `Work Completion Certificate - ${project.projectName}`,
        html: emailHtmlContent,
        attachments: [
          {
            filename: `Work-Completion-${project.projectNumber}.pdf`,
            content: pdfBuffer as any,
            contentType: 'application/pdf'
          }
        ]
      });

      const ccMessage = cc && cc.length > 0 ? ` with CC to ${cc.length} recipient(s)` : '';
      res.status(200).json(
        new ApiResponse(200, null, `Work completion email sent successfully${ccMessage}`)
      );
    } catch (error) {
      console.error("Error sending work completion email:", error);
      throw new ApiError(500, "Failed to send work completion email");
    }
  }
);

// Helper function to generate PDF buffer
const generateWorkCompletionPdfBuffer = async (
  project: any,
  client: IClient,
  workCompletion: any,
  lpo: any
) => {
  const engineer: any = project.assignedTo;
  const preparedBy: any = workCompletion?.createdBy;

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return "";
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/ /g, "-");
  };

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Completion Certificate</title>
        <style>
            @page {
              size: A4;
              margin: 0.5in;
            }
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 0;
                color: #000;
                border: 2px solid #800080;
                font-size: 11pt;
                line-height: 1.5;
            }
            .container {
                width: 96%;
                margin: 0 auto;
                padding: 15px;
                padding-bottom: 60px;
            }
            .header {
                display: flex;
                align-items: center;
                margin-bottom: 15px;
                border-bottom: 2px solid #94d7f4;
                padding-bottom: 15px;
            }
            .logo {
                max-height: 70px;
                margin-right: 25px;
            }
            .title-container {
                flex-grow: 1;
                text-align: end;
            }
            h1 {
                color: #800080;
                font-size: 28px;
                font-weight: bold;
                margin: 0;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .highlight {
                padding: 2px 6px;
                background-color: #f0f8ff;
                border-radius: 3px;
                font-weight: 600;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 12px 0;
                font-size: 11pt;
            }
            td {
                padding: 8px 10px;
                vertical-align: top;
                line-height: 1.4;
            }
            .bordered {
                border: 1px solid #000;
                margin: 15px 0;
            }
            .bordered td {
                border: 1px solid #000;
            }
            .bold {
                font-weight: bold;
                color: #2c3e50;
            }
            .section-title {
                margin: 20px 0 8px 0;
                font-weight: bold;
                font-size: 14pt;
                color: #2c3e50;
                border-bottom: 1px solid #94d7f4;
                padding-bottom: 5px;
            }
            .signature-img {
                height: 50px;
                max-width: 180px;
                object-fit: contain;
            }
            .green-text {
                color: #228B22;
                font-weight: bold;
                font-size: 11pt;
            }
            .blue-bg {
                background-color: #94d7f4;
                color: #000;
                font-weight: bold;
                padding: 8px 12px;
                font-size: 12pt;
                text-align: center;
            }
            .image-container {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
                margin: 15px 0 10px 0;
                justify-content: center;
            }
            .image-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                flex-grow: 1;
                max-width: 200px;
                margin-bottom: 15px;
            }
            .image-item img {
                height: 120px;
                width: 100%;
                border: 1px solid #ddd;
                object-fit: cover;
                margin-bottom: 8px;
                border-radius: 4px;
            }
            .image-title {
                font-size: 10.5pt;
                font-weight: 600;
                text-align: center;
                color: #333;
                word-wrap: break-word;
                width: 100%;
                padding: 4px 6px;
                background-color: #f8f9fa;
                border-radius: 3px;
            }
            .footer-container {
                margin-top: 25px;
                width: 96%;
                margin-left: auto;
                margin-right: auto;
                page-break-inside: avoid;
            }
            .tagline {
                text-align: center;
                font-weight: bold;
                font-size: 13pt;
                margin: 15px 0 10px 0;
                color: #2c3e50;
            }
            .footer {
                text-align: center;
                font-size: 10pt;
                color: #555;
                border-top: 2px solid #ddd;
                padding-top: 12px;
                margin-top: 10px;
                line-height: 1.6;
            }
            .footer p {
                margin: 6px 0;
            }
            .footer strong {
                color: #2c3e50;
                font-size: 10.5pt;
            }
            .certification-text {
                margin: 15px 0;
                padding: 12px 15px;
                background-color: #f8f9fa;
                border-left: 4px solid #94d7f4;
                border-radius: 4px;
                font-size: 11.5pt;
                line-height: 1.6;
                color: #333;
            }
            .signature-section {
                margin: 5px 0;
            }
            .signature-name {
                font-weight: 600;
                color: #2c3e50;
                margin-top: 5px;
            }
            .empty-signature {
                height: 50px;
                border: 1px dashed #ccc;
                background-color: #f9f9f9;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #999;
                font-size: 10pt;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <img src="https://agats.s3.ap-south-1.amazonaws.com/logo/alghlogo.jpg" alt="Company Logo" class="logo">
                <div class="title-container">
                    <h1>Completion Certificate</h1>
                </div>
            </div>

            <table>
                <tr>
                    <td class="bold" style="width: 30%">Reference</td>
                    <td>: <span class="highlight">${`QTN${project.projectNumber.slice(3, 40)}`}</span></td>
                </tr>
                <tr>
                    <td class="bold">FM CONTRACTOR</td>
                    <td>: ${client.clientName}</td>
                </tr>
                <tr>
                    <td class="bold">SUB CONTRACTOR</td>
                    <td>: AL GHAZAL ALABYAD TECHNICAL SERVICES</td>
                </tr>
                <tr>
                    <td class="bold">PROJECT DESCRIPTION</td>
                    <td>: <span class="highlight">${project.projectName}</span></td>
                </tr>
                <tr>
                    <td class="bold">LOCATION (Bldg.)</td>
                    <td>: <span class="highlight">${project.location}${project.building ? `, ${project.building}` : ""}</span></td>
                </tr>
            </table>

            <div class="certification-text">
                This is to certify that the work described above in the project description has been cleared out and completed to the required standards and specifications.
            </div>

            <table>
                <tr>
                    <td class="bold" style="width: 30%">Completion Date</td>
                    <td>: <span class="highlight">${formatDate(project.completionDate)}</span></td>
                </tr>
                <tr>
                    <td class="bold">LPO Number</td>
                    <td>: ${lpo?.lpoNumber || "N/A"}</td>
                </tr>
                <tr>
                    <td class="bold">LPO Date</td>
                    <td>: ${formatDate(lpo?.lpoDate)}</td>
                </tr>
            </table>

            <table class="bordered">
                <tr>
                    <td colspan="2" class="blue-bg">Hand over by:</td>
                    <td colspan="2" class="blue-bg">AL GHAZAL AL ABYAD TECHNICAL SERVICES</td>
                </tr>
                <tr>
                    <td class="bold" style="width: 25%">Name:</td>
                    <td style="width: 25%" class="signature-name">${engineer?.firstName} ${engineer?.lastName || ""}</td>
                    <td class="bold" style="width: 25%">Signature:</td>
                    <td style="width: 25%" class="signature-section">
                        ${engineer?.signatureImage ? `<img src="${engineer.signatureImage}" class="signature-img" />` : '<div class="empty-signature">Signature</div>'}
                    </td>
                </tr>
                <tr>
                    <td class="bold">Date:</td>
                    <td><span class="green-text">${formatDate(project.handoverDate)}</span></td>
                    <td></td>
                    <td></td>
                </tr>
            </table>

            <table class="bordered">
                <tr>
                    <td colspan="2" class="blue-bg">Accepted by:</td>
                    <td colspan="2" class="blue-bg">Client side</td>
                </tr>
                <tr>
                    <td class="bold" style="width: 25%">Name:</td>
                    <td style="width: 25%" class="signature-name">${client.clientName}</td>
                    <td class="bold" style="width: 25%">Signature:</td>
                    <td style="width: 25%" class="signature-section">
                        <div class="empty-signature">Client Signature</div>
                    </td>
                </tr>
                <tr>
                    <td class="bold">Date:</td>
                    <td>${formatDate(project.acceptanceDate)}</td>
                    <td></td>
                    <td></td>
                </tr>
            </table>

            <table class="bordered">
                <tr>
                    <td colspan="2" class="blue-bg">Prepared by:</td>
                    <td colspan="2" class="blue-bg">AL GHAZAL AL ABYAD TECHNICAL SERVICES</td>
                </tr>
                <tr>
                    <td class="bold" style="width: 25%">Name:</td>
                    <td style="width: 25%" class="signature-name">${preparedBy?.firstName || ""} ${preparedBy?.lastName || ""}</td>
                    <td class="bold" style="width: 25%">Signature:</td>
                    <td style="width: 25%" class="signature-section">
                        ${preparedBy?.signatureImage ? `<img src="${preparedBy.signatureImage}" class="signature-img" />` : '<div class="empty-signature">Signature</div>'}
                    </td>
                </tr>
                <tr>
                    <td class="bold">Date:</td>
                    <td><span class="green-text">${formatDate(project.handoverDate)}</span></td>
                    <td></td>
                    <td></td>
                </tr>
            </table>

            <div class="section-title">Site Pictures:</div>
            <div class="image-container">
                ${workCompletion?.images && workCompletion.images.length > 0
                  ? workCompletion.images.map((image: any) => 
                      `<div class="image-item">
                         <img src="${image.imageUrl}" alt="${image.title || "Site picture"}" />
                         <div class="image-title">${image.title || "Site Image"}</div>
                       </div>`
                    ).join("")
                  : '<p style="text-align: center; width: 100%; font-size: 11pt; color: #666; padding: 20px;">No site pictures available</p>'
                }
            </div>
        </div>

        <div class="footer-container">
            <div class="tagline">We work U Relax</div>
            <div class="footer">
                <p><strong>AL GHAZAL AL ABYAD TECHNICAL SERVICES</strong></p>
                <p>Office No:04, R09-France Cluster, International City-Dubai | P.O.Box:262760, Dubai-U.A.E</p>
                <p>Tel: 044102555 | <a href="http://www.alghazalgroup.com/" style="color: #0074cc; text-decoration: none;">www.alghazalgroup.com</a></p>
                <p>Generated on ${formatDate(new Date())}</p>
            </div>
        </div>
    </body>
    </html>
  `;

  const browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });
    await page.setContent(htmlContent, {
      waitUntil: ["load", "networkidle0", "domcontentloaded"],
      timeout: 30000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0.5in",
        right: "0.5in",
        bottom: "0.5in",
        left: "0.5in",
      },
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });

    return pdfBuffer;
  } catch (error) {
    console.error("PDF generation error:", error);
    throw new ApiError(500, "Failed to generate PDF");
  } finally {
    await browser.close();
  }
};

// Email template function
const createWorkCompletionEmailTemplate = (
  project: any,
  client: IClient,
  workCompletion: any
): string => {
  const formatDate = (date: Date | string | undefined) => {
    if (!date) return "N/A";
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const preparedBy: any = workCompletion?.createdBy;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Work Completion Certificate</title>
  <style>
    body {
      font-family: 'Arial', sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 20px;
      background-color: #f9f9f9;
    }
    
    .email-container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    
    .email-header {
      background: linear-gradient(135deg, #800080, #9b30ff);
      color: white;
      padding: 20px;
      text-align: center;
    }
    
    .email-body {
      padding: 30px;
    }
    
    .greeting {
      margin-bottom: 20px;
      font-size: 16px;
    }
    
    .client-name {
      background-color: #ffeb3b;
      padding: 2px 6px;
      font-weight: bold;
      color: #333;
    }
    
    .content-section {
      margin-bottom: 25px;
    }
    
    .content-line {
      margin-bottom: 12px;
      font-size: 14px;
    }
    
    .attachment-notice {
      background: #e3f2fd;
      border-left: 4px solid #2196f3;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }
    
    .signature {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #e0e0e0;
    }
    
    .sender-name {
      font-weight: bold;
      font-size: 16px;
      color: #2c3e50;
    }
    
    .company-name {
      font-weight: bold;
      color: #800080;
      margin-top: 5px;
    }
    
    .completion-details {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 6px;
      margin: 20px 0;
    }
    
    .detail-row {
      display: flex;
      margin-bottom: 8px;
    }
    
    .detail-label {
      font-weight: bold;
      min-width: 150px;
      color: #2c3e50;
    }
    
    .footer {
      background: #2c3e50;
      color: white;
      padding: 20px;
      text-align: center;
      font-size: 12px;
    }
    
    .footer a {
      color: #9b30ff;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>Work Completion Certificate</h1>
      <p>${project.projectName}</p>
    </div>
    
    <div class="email-body">
      <div class="greeting">
        Dear <span class="client-name">${client.clientName}</span>,
      </div>
      
      <div class="content-section">
        <div class="content-line">
          We are pleased to inform you that the work on the project <strong>"${project.projectName}"</strong> has been successfully completed.
        </div>
        
        <div class="completion-details">
          <div class="detail-row">
            <span class="detail-label">Project:</span>
            <span>${project.projectName}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Location:</span>
            <span>${project.location}${project.building ? `, ${project.building}` : ""}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Completion Date:</span>
            <span>${formatDate(project.completionDate)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Handover Date:</span>
            <span>${formatDate(project.handoverDate)}</span>
          </div>
        </div>
        
        <div class="content-line">
          The attached Work Completion Certificate contains complete details including:
        </div>
        <ul>
          <li>Project reference and description</li>
          <li>Handover and acceptance information</li>
          <li>LPO details</li>
          ${workCompletion?.images && workCompletion.images.length > 0 ? '<li>Site completion pictures</li>' : ''}
          <li>Official signatures and stamps</li>
        </ul>
      </div>
      
      <div class="attachment-notice">
        <strong>📎 Attachment:</strong> Work-Completion-${project.projectNumber}.pdf
      </div>
      
      <div class="content-line">
        All work has been completed as per the agreed specifications and requirements. We hope you are satisfied with the quality of work delivered.
      </div>
      
      <div class="content-line">
        Should you have any questions or require further information, please feel free to contact us.
      </div>
      
      <div class="signature">
        <div>Best regards,</div>
        <div class="sender-name">${preparedBy?.firstName || ""} ${preparedBy?.lastName || ""}</div>
        <div class="company-name">AL GHAZAL AL ABYAD TECHNICAL SERVICES</div>
      </div>
    </div>
    
    <div class="footer">
      <p><strong>AL GHAZAL AL ABYAD TECHNICAL SERVICES</strong></p>
      <p>Office No:04, R09-France Cluster, International City-Dubai | P.O.Box:262760, Dubai-U.A.E</p>
      <p>Tel: 044102555 | <a href="http://www.alghazalgroup.com/">www.alghazalgroup.com</a></p>
    </div>
  </div>
</body>
</html>`;
};