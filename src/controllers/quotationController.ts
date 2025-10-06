import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Quotation } from "../models/quotationModel";
import { IProject, Project } from "../models/projectModel";
import { Estimation } from "../models/estimationModel";
import { uploadItemImage, deleteFileFromS3 } from "../utils/uploadConf";
import puppeteer from "puppeteer";
import { generateRelatedDocumentNumber } from "../utils/documentNumbers";
import { IUser } from "../models/userModel";
import { IClient } from "../models/clientModel";

export const createQuotation = asyncHandler(
  async (req: Request, res: Response) => {
    // Debugging logs
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);

    if (!req.files || !Array.isArray(req.files)) {
      throw new ApiError(400, "No files were uploaded");
    }

    // Parse the JSON data from form-data
    let jsonData;
    try {
      jsonData = JSON.parse(req.body.data);
    } catch (error) {
      throw new ApiError(400, "Invalid JSON data format");
    }

    const {
      project: projectId,
      validUntil,
      scopeOfWork = [],
      items = [],
      termsAndConditions = [],
      vatPercentage = 5,
    } = jsonData;

    // Validate items is an array
    if (!Array.isArray(items)) {
      throw new ApiError(400, "Items must be an array");
    }

    // Check for existing quotation
    const exists = await Quotation.findOne({ project: projectId });
    if (exists) throw new ApiError(400, "Project already has a quotation");

    const estimation = await Estimation.findOne({ project: projectId });
    const estimationId = estimation?._id;

    // Process items with their corresponding files
    const processedItems = await Promise.all(
      items.map(async (item: any, index: number) => {
        // Find the image file for this item using the correct fieldname pattern
        const imageFile = (req.files as Express.Multer.File[]).find(
          (f) => f.fieldname === `items[${index}][image]`
        );

        if (imageFile) {
          console.log(`Processing image for item ${index}:`, imageFile);
          const uploadResult = await uploadItemImage(imageFile);
          if (uploadResult.uploadData) {
            item.image = uploadResult.uploadData;
          }
        } else {
          console.log(`No image found for item ${index}`);
        }

        item.totalPrice = item.quantity * item.unitPrice;
        return item;
      })
    );

    // Calculate financial totals
    const subtotal = processedItems.reduce(
      (sum, item) => sum + item.totalPrice,
      0
    );
    const vatAmount = subtotal * (vatPercentage / 100);
    const total = subtotal + vatAmount;

    const quotation = await Quotation.create({
      project: projectId,
      estimation: estimationId,
      quotationNumber: await generateRelatedDocumentNumber(projectId, "QTNAGA"),
      date: new Date(),
      validUntil: new Date(validUntil),
      scopeOfWork,
      items: processedItems,
      termsAndConditions,
      vatPercentage,
      subtotal,
      vatAmount,
      netAmount: total,
      preparedBy: req.user?.userId,
    });

    await Project.findByIdAndUpdate(projectId, { status: "quotation_sent" });

    res.status(201).json(new ApiResponse(201, quotation, "Quotation created"));
  }
);

export const getQuotationByProject = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const quotation = await Quotation.findOne({ project: projectId })
      .populate("project", "projectName")
      .populate("preparedBy", "firstName lastName");

    if (!quotation) throw new ApiError(404, "Quotation not found");
    res
      .status(200)
      .json(new ApiResponse(200, quotation, "Quotation retrieved"));
  }
);

export const updateQuotation = asyncHandler(
  async (req: Request, res: Response) => {
    // Debugging logs
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);

    if (!req.files || !Array.isArray(req.files)) {
      throw new ApiError(400, "No files were uploaded");
    }

    // Parse the JSON data from form-data
    let jsonData;
    try {
      jsonData = JSON.parse(req.body.data);
    } catch (error) {
      throw new ApiError(400, "Invalid JSON data format");
    }

    const { id } = req.params;
    const {
      items = [],
      validUntil,
      scopeOfWork,
      termsAndConditions,
      vatPercentage,
    } = jsonData;

    // Validate items is an array
    if (!Array.isArray(items)) {
      throw new ApiError(400, "Items must be an array");
    }

    const quotation = await Quotation.findById(id);
    if (!quotation) throw new ApiError(404, "Quotation not found");

    // Process items with their corresponding files
    const processedItems = await Promise.all(
      items.map(async (item: any, index: number) => {
        // Find the image file for this item using the correct fieldname pattern
        const imageFile = (req.files as Express.Multer.File[]).find(
          (f) => f.fieldname === `items[${index}][image]`
        );

        // If new image is uploaded
        if (imageFile) {
          console.log(`Processing image for item ${index}:`, imageFile);

          // Delete old image if it exists
          if (item.image?.key) {
            await deleteFileFromS3(item.image.key);
          }

          // Upload new image
          const uploadResult = await uploadItemImage(imageFile);
          if (uploadResult.uploadData) {
            item.image = uploadResult.uploadData;
          }
        } else if (item.image && typeof item.image === 'object') {
          // Keep existing image if no new one was uploaded
          item.image = item.image;
        } else {
          // No image for this item
          item.image = undefined;
        }

        // Calculate total price
        item.totalPrice = item.quantity * item.unitPrice;
        return item;
      })
    );

    // Calculate financial totals
    const subtotal = processedItems.reduce(
      (sum, item) => sum + item.totalPrice,
      0
    );
    const vatAmount = subtotal * ((vatPercentage || quotation.vatPercentage) / 100);
    const total = subtotal + vatAmount;

    // Update quotation fields
    quotation.items = processedItems;
    if (validUntil) quotation.validUntil = new Date(validUntil);
    if (scopeOfWork) quotation.scopeOfWork = scopeOfWork;
    if (termsAndConditions) quotation.termsAndConditions = termsAndConditions;
    if (vatPercentage) quotation.vatPercentage = vatPercentage;
    quotation.subtotal = subtotal;
    quotation.vatAmount = vatAmount;
    quotation.netAmount = total;

    await quotation.save();

    res.status(200).json(new ApiResponse(200, quotation, "Quotation updated"));
  }
);

export const approveQuotation = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { isApproved, comment } = req.body;

    const quotation = await Quotation.findByIdAndUpdate(
      id,
      {
        isApproved,
        approvalComment: comment,
        approvedBy: req.user?.userId,
      },
      { new: true }
    );

    await Project.findByIdAndUpdate(quotation?.project, {
      status: isApproved ? "quotation_approved" : "quotation_rejected",
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          quotation,
          `Quotation ${isApproved ? "approved" : "rejected"}`
        )
      );
  }
);

export const deleteQuotation = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const quotation = await Quotation.findByIdAndDelete(id);

    if (!quotation) throw new ApiError(404, "Quotation not found");

    await Promise.all(
      quotation.items.map((item) =>
        item.image?.key ? deleteFileFromS3(item.image.key) : Promise.resolve()
      )
    );

    await Project.findByIdAndUpdate(quotation.project, {
      status: "estimation_prepared",
    });

    res.status(200).json(new ApiResponse(200, null, "Quotation deleted"));
  }
);

export const generateQuotationPdf = asyncHandler(
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
    const site = `${project.location} ${project.building} ${project.apartmentNumber}`;

    // Calculate totals
    const subtotal = quotation.items.reduce((sum, item) => sum + item.totalPrice, 0);
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
      line-height: 1.5;
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
      margin-bottom: 20px;
    }

    .header {
      display: flex;
      align-items: flex-start;
      margin-bottom: 15px;
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
      margin-bottom: 12px;
      gap: 20px;
      page-break-after: avoid;
    }

    .client-info {
      flex: 1;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 10pt;
      background-color: #f8f9fa;
    }

    .client-info p {
      margin: 6px 0;
      line-height: 1.4;
    }

    .client-info strong {
      font-weight: 600;
      color: #2c3e50;
    }

    .quotation-info {
      width: 250px;
    }

    .quotation-details {
      width: 100%;
      border-collapse: collapse;
      font-size: 10pt;
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
      color: #2c3e50;
    }

    .subject-section {
      margin: 12px 0;
      padding: 10px 12px;
      background-color: #f8f9fa;
      border-radius: 4px;
      page-break-after: avoid;
    }

    .subject-title {
      font-weight: bold;
      font-size: 11pt;
      margin-bottom: 6px;
      color: #2c3e50;
    }

    .subject-content {
      font-size: 10.5pt;
      color: #333;
      font-weight: 500;
    }

    .section {
      margin-bottom: 15px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 12pt;
      font-weight: bold;
      padding: 6px 0;
      margin: 12px 0 8px 0;
      border-bottom: 2px solid #94d7f4;
      page-break-after: avoid;
      color: #2c3e50;
    }

    /* Critical fix for table page breaks */
    .table-container {
      page-break-inside: auto;
      overflow: visible;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
      page-break-inside: auto;
      font-size: 10pt;
      table-layout: fixed;
    }

    thead {
      display: table-header-group;
    }

    tbody {
      display: table-row-group;
    }

    /* Allow rows to break across pages but keep cells intact */
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
      padding: 6px 8px;
      text-align: left;
      border: 1px solid #ddd;
      font-size: 10pt;
      word-wrap: break-word;
    }

    td {
      padding: 6px 8px;
      border: 1px solid #ddd;
      vertical-align: top;
      font-size: 10pt;
      word-wrap: break-word;
    }

    /* Preserve line breaks in description */
    .col-desc {
      white-space: pre-wrap;
    }

    /* Optimized column widths for better fit */
    .col-no { width: 5%; }
    .col-desc { width: 30%; }
    .col-uom { width: 8%; }
    .col-image { width: 12%; }
    .col-qty { width: 8%; }
    .col-unit { width: 12%; }
    .col-total { width: 10%; }

    td img {
      max-height: 60px;
      object-fit: contain;
      page-break-inside: avoid;
    }

    .amount-summary {
      margin-top: 12px;
      width: 100%;
      text-align: right;
      page-break-before: avoid;
      font-size: 10.5pt;
    }

    .amount-summary-row {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 6px;
    }

    .amount-label {
      width: 150px;
      font-weight: bold;
      text-align: right;
      padding-right: 12px;
      font-size: 10pt;
    }

    .amount-value {
      width: 100px;
      text-align: right;
      font-size: 10pt;
    }

    .net-amount-row {
      display: flex;
      justify-content: flex-end;
      background-color: #94d7f4;
      color: #000;
      font-weight: bold;
      font-size: 11pt;
      margin-top: 6px;
      padding: 6px 0;
      border-top: 2px solid #333;
    }

    .terms-prepared-section {
      margin-top: 15px;
      page-break-inside: avoid;
    }

    .terms-prepared-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 6px;
      border-bottom: 2px solid #94d7f4;
      margin-bottom: 12px;
      page-break-after: avoid;
    }

    .terms-title, .prepared-title {
      font-size: 11pt;
      font-weight: bold;
      margin: 0;
      color: #2c3e50;
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
      font-size: 10pt;
    }

    .terms-box {
      border: 1px solid #000;
      padding: 10px 12px;
      width: 100%;
      box-sizing: border-box;
      font-size: 10pt;
      line-height: 1.5;
    }

    .terms-box ol {
      margin: 0;
      padding-left: 18px;
    }

    .terms-box li {
      margin-bottom: 6px;
    }

    .prepared-by-name {
      font-weight: bold;
      margin-top: 6px;
      font-size: 10.5pt;
      color: #2c3e50;
    }

    .prepared-by-title {
      font-size: 9.5pt;
      color: #555;
      margin-top: 4px;
    }

    .tagline {
      text-align: center;
      font-weight: bold;
      font-size: 12pt;
      margin: 20px 0 12px 0;
      color: #2c3e50;
      border-top: 2px solid #ddd;
      padding-top: 12px;
      page-break-before: avoid;
    }

    .footer {
      font-size: 9pt;
      color: #555;
      text-align: center;
      margin-top: 12px;
      page-break-inside: avoid;
      line-height: 1.5;
    }

    .footer p {
      margin: 6px 0;
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
      margin: 6px 0;
      line-height: 1.4;
    }

    strong {
      font-weight: 600;
    }

    /* Print-specific optimizations */
    @media print {
      thead { 
        display: table-header-group; 
      }
      tfoot { 
        display: table-footer-group; 
      }
      
      /* Critical fix: Allow tables to break naturally across pages */
      table {
        page-break-inside: auto;
      }
      
      tr {
        break-inside: avoid;
        break-after: auto;
      }

      /* Prevent the subject section from breaking awkwardly */
      .subject-section {
        page-break-after: avoid;
        page-break-inside: avoid;
      }

      /* Ensure items section starts on new page if it doesn't fit */
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
    }

    /* Force page break if needed */
    .page-break {
      page-break-before: always;
    }

    /* Prevent header sections from breaking across pages */
    .header-section {
      page-break-after: avoid;
      page-break-inside: avoid;
    }

    .no-small-text {
      font-size: 9pt !important;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="content">
      <!-- Header Section - Keep together -->
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

        <!-- Subject Section - Keep with header -->
        <div class="subject-section">
          <div class="subject-title">SUBJECT</div>
          <div class="subject-content">${project.projectName || "N/A"}</div>
        </div>
      </div>

      <!-- Items Section - Allow to break naturally across pages -->
      <div class="section items-section">
        <div class="section-title">ITEMS</div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th class="col-no">No.</th>
                <th class="col-desc">Description</th>
                <th class="col-uom">UOM</th>
                <th class="col-image">Image</th>
                <th class="col-qty">Qty</th>
                <th class="col-unit">Unit Price (AED)</th>
                <th class="col-total text-right">Total (AED)</th>
              </tr>
            </thead>
            <tbody>
              ${quotation.items.map((item, index) => `
                <tr>
                  <td class="text-center col-no">${index + 1}</td>
                  <td class="col-desc">${item.description}</td>
                  <td class="text-center col-uom">${item.uom || "NOS"}</td>
                  <td class="text-center col-image" style="padding: 6px;">
                    ${item.image?.url ? `<img src="${item.image.url}" style="width: 100%; height: auto; max-height: 60px; object-fit: contain;"/>` : ""}
                  </td>
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
                ${quotation.termsAndConditions.map(term => `<li>${term}</li>`).join("")}
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

      // Set viewport for consistent rendering
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

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=quotation-${quotation.quotationNumber}.pdf`
      );
      res.send(pdfBuffer);
    } catch (error) {
      console.error("PDF generation error:", error);
      throw new ApiError(500, "Failed to generate PDF");
    } finally {
      await browser.close();
    }
  }
);