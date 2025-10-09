// Add this to your quotationController.ts file

import { IClient } from "../models/clientModel";
import { IProject, Project } from "../models/projectModel";
import { Quotation } from "../models/quotationModel";
import { IUser } from "../models/userModel";
import { ApiError, ApiResponse } from "../utils/apiHandlerHelpers";
import { asyncHandler } from "../utils/asyncHandler";
import { mailer } from "../utils/mailer";
import { Request, Response } from "express";
import puppeteer from "puppeteer";

export const sendQuotationEmail = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

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

    // Check if client has email
    if (!client.email) {
      throw new ApiError(400, "Client email not found");
    }

    // Generate PDF first
    const pdfBuffer = await generateQuotationPdfBuffer(quotation, client, preparedBy, project);

    // Create email HTML content using the template
    const emailHtmlContent = createQuotationEmailTemplate(
      quotation.quotationNumber,
      client.clientName,
      `${preparedBy.firstName} ${preparedBy.lastName}`
    );

    try {
      // Send email with PDF attachment
      await mailer.sendEmail({
        to: client.email,
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

      // Update project status to quotation_sent if not already
     
      res.status(200).json(
        new ApiResponse(200, null, "Quotation email sent successfully")
      );
    } catch (error) {
      console.error("Error sending quotation email:", error);
      throw new ApiError(500, "Failed to send quotation email");
    }
  }
);

// Helper function to generate PDF buffer (using the same template as your PDF generation)
const generateQuotationPdfBuffer = async (
  quotation: any,
  client: IClient,
  preparedBy: IUser,
  project: IProject
) => {
  const site = `${project.location} ${project.building} ${project.apartmentNumber}`;
  
  // Calculate totals
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

  // Function to clean up description - remove extra blank lines
  const cleanDescription = (description: string) => {
    return description.replace(/\n\n+/g, '\n').trim();
  };

  // Use the exact same HTML content from your PDF generation template
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
      align-items: flex-start;
      margin-bottom: 10px;
      gap: 15px;
      page-break-after: avoid;
    }

    .logo {
      height: 55px;
      width: auto;
      max-width: 180px;
    }

    .header-content {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-end;
    }

    .document-title {
      font-size: 16pt;
      font-weight: bold;
      margin: 0;
      color: #000;
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

    /* Compact Images Section - Card Layout */
    .images-section {
      margin-top: 12px;
      page-break-inside: avoid;
    }

    .images-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }

    .image-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: calc(33.333% - 8px);
      margin-bottom: 8px;
      page-break-inside: avoid;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 6px;
      background: #fafafa;
    }

    .image-card img {
      max-height: 80px;
      width: auto;
      max-width: 100%;
      object-fit: contain;
      border-radius: 4px;
    }

    .image-content {
      width: 100%;
      margin-top: 4px;
    }

    .image-title {
      font-size: 8.5pt;
      font-weight: bold;
      text-align: center;
      color: #2c3e50;
      line-height: 1.2;
      margin-bottom: 2px;
    }

    .image-description {
      font-size: 7.5pt;
      text-align: center;
      color: #666;
      line-height: 1.2;
      margin-bottom: 2px;
    }

    .image-category {
      font-size: 7pt;
      text-align: center;
      color: #94d7f4;
      font-weight: bold;
      background: #e3f2fd;
      padding: 2px 6px;
      border-radius: 10px;
      display: inline-block;
      margin: 0 auto;
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

      .image-card {
        page-break-inside: avoid;
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
          <div class="header-content">
            <div class="document-title">QUOTE</div>
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
          ${quotation.images.map((image: any) => {
            const itemCategory = image.relatedItemIndex !== undefined 
              ? `Item ${image.relatedItemIndex + 1}`
              : 'General Image';
            
            return `
            <div class="image-card">
              <img src="${image.imageUrl}" alt="${image.title}" />
              <div class="image-content">
                <div class="image-title">${image.title}</div>
                ${image.description ? `<div class="image-description">${image.description}</div>` : ''}
                <div class="image-category">${itemCategory}</div>
              </div>
            </div>
            `;
          }).join('')}
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

// Helper function to create email HTML template (unchanged)
const createQuotationEmailTemplate = (
  quotationNumber: string,
  clientName: string,
  senderName: string
): string => {
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