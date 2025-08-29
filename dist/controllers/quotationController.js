"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateQuotationPdf = exports.deleteQuotation = exports.approveQuotation = exports.updateQuotation = exports.getQuotationByProject = exports.createQuotation = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const quotationModel_1 = require("../models/quotationModel");
const projectModel_1 = require("../models/projectModel");
const estimationModel_1 = require("../models/estimationModel");
const uploadConf_1 = require("../utils/uploadConf");
const puppeteer_1 = __importDefault(require("puppeteer"));
const documentNumbers_1 = require("../utils/documentNumbers");
exports.createQuotation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    // Debugging logs
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);
    if (!req.files || !Array.isArray(req.files)) {
        throw new apiHandlerHelpers_2.ApiError(400, "No files were uploaded");
    }
    // Parse the JSON data from form-data
    let jsonData;
    try {
        jsonData = JSON.parse(req.body.data);
    }
    catch (error) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid JSON data format");
    }
    const { project: projectId, validUntil, scopeOfWork = [], items = [], termsAndConditions = [], vatPercentage = 5, } = jsonData;
    // Validate items is an array
    if (!Array.isArray(items)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Items must be an array");
    }
    // Check for existing quotation
    const exists = await quotationModel_1.Quotation.findOne({ project: projectId });
    if (exists)
        throw new apiHandlerHelpers_2.ApiError(400, "Project already has a quotation");
    const estimation = await estimationModel_1.Estimation.findOne({ project: projectId });
    const estimationId = estimation?._id;
    // Process items with their corresponding files
    const processedItems = await Promise.all(items.map(async (item, index) => {
        // Find the image file for this item using the correct fieldname pattern
        const imageFile = req.files.find((f) => f.fieldname === `items[${index}][image]`);
        if (imageFile) {
            console.log(`Processing image for item ${index}:`, imageFile);
            const uploadResult = await (0, uploadConf_1.uploadItemImage)(imageFile);
            if (uploadResult.uploadData) {
                item.image = uploadResult.uploadData;
            }
        }
        else {
            console.log(`No image found for item ${index}`);
        }
        item.totalPrice = item.quantity * item.unitPrice;
        return item;
    }));
    // Calculate financial totals
    const subtotal = processedItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const vatAmount = subtotal * (vatPercentage / 100);
    const total = subtotal + vatAmount;
    const quotation = await quotationModel_1.Quotation.create({
        project: projectId,
        estimation: estimationId,
        quotationNumber: await (0, documentNumbers_1.generateRelatedDocumentNumber)(projectId, "QTN"),
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
    await projectModel_1.Project.findByIdAndUpdate(projectId, { status: "quotation_sent" });
    res.status(201).json(new apiHandlerHelpers_1.ApiResponse(201, quotation, "Quotation created"));
});
exports.getQuotationByProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const quotation = await quotationModel_1.Quotation.findOne({ project: projectId })
        .populate("project", "projectName")
        .populate("preparedBy", "firstName lastName");
    if (!quotation)
        throw new apiHandlerHelpers_2.ApiError(404, "Quotation not found");
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, quotation, "Quotation retrieved"));
});
exports.updateQuotation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    // Debugging logs
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);
    if (!req.files || !Array.isArray(req.files)) {
        throw new apiHandlerHelpers_2.ApiError(400, "No files were uploaded");
    }
    // Parse the JSON data from form-data
    let jsonData;
    try {
        jsonData = JSON.parse(req.body.data);
    }
    catch (error) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid JSON data format");
    }
    const { id } = req.params;
    const { items = [], validUntil, scopeOfWork, termsAndConditions, vatPercentage, } = jsonData;
    // Validate items is an array
    if (!Array.isArray(items)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Items must be an array");
    }
    const quotation = await quotationModel_1.Quotation.findById(id);
    if (!quotation)
        throw new apiHandlerHelpers_2.ApiError(404, "Quotation not found");
    // Process items with their corresponding files
    const processedItems = await Promise.all(items.map(async (item, index) => {
        // Find the image file for this item using the correct fieldname pattern
        const imageFile = req.files.find((f) => f.fieldname === `items[${index}][image]`);
        // If new image is uploaded
        if (imageFile) {
            console.log(`Processing image for item ${index}:`, imageFile);
            // Delete old image if it exists
            if (item.image?.key) {
                await (0, uploadConf_1.deleteFileFromS3)(item.image.key);
            }
            // Upload new image
            const uploadResult = await (0, uploadConf_1.uploadItemImage)(imageFile);
            if (uploadResult.uploadData) {
                item.image = uploadResult.uploadData;
            }
        }
        else if (item.image && typeof item.image === 'object') {
            // Keep existing image if no new one was uploaded
            item.image = item.image;
        }
        else {
            // No image for this item
            item.image = undefined;
        }
        // Calculate total price
        item.totalPrice = item.quantity * item.unitPrice;
        return item;
    }));
    // Calculate financial totals
    const subtotal = processedItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const vatAmount = subtotal * ((vatPercentage || quotation.vatPercentage) / 100);
    const total = subtotal + vatAmount;
    // Update quotation fields
    quotation.items = processedItems;
    if (validUntil)
        quotation.validUntil = new Date(validUntil);
    if (scopeOfWork)
        quotation.scopeOfWork = scopeOfWork;
    if (termsAndConditions)
        quotation.termsAndConditions = termsAndConditions;
    if (vatPercentage)
        quotation.vatPercentage = vatPercentage;
    quotation.subtotal = subtotal;
    quotation.vatAmount = vatAmount;
    quotation.netAmount = total;
    await quotation.save();
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, quotation, "Quotation updated"));
});
exports.approveQuotation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { isApproved, comment } = req.body;
    const quotation = await quotationModel_1.Quotation.findByIdAndUpdate(id, {
        isApproved,
        approvalComment: comment,
        approvedBy: req.user?.userId,
    }, { new: true });
    await projectModel_1.Project.findByIdAndUpdate(quotation?.project, {
        status: isApproved ? "quotation_approved" : "quotation_rejected",
    });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, quotation, `Quotation ${isApproved ? "approved" : "rejected"}`));
});
exports.deleteQuotation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const quotation = await quotationModel_1.Quotation.findByIdAndDelete(id);
    if (!quotation)
        throw new apiHandlerHelpers_2.ApiError(404, "Quotation not found");
    await Promise.all(quotation.items.map((item) => item.image?.key ? (0, uploadConf_1.deleteFileFromS3)(item.image.key) : Promise.resolve()));
    await projectModel_1.Project.findByIdAndUpdate(quotation.project, {
        status: "estimation_prepared",
    });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, null, "Quotation deleted"));
});
exports.generateQuotationPdf = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
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
        throw new apiHandlerHelpers_2.ApiError(404, "Quotation not found");
    if (!quotation.project || typeof quotation.project !== "object" || !("client" in quotation.project)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Client information not found");
    }
    const client = quotation.project.client;
    const preparedBy = quotation.preparedBy;
    const project = quotation.project;
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
      position: relative;
      min-height: 100vh;
    }
    .header {
      display: flex;
      align-items: center;
      margin-bottom: 15px;
    }
    .logo {
      height: 50px;
      width: auto;
      margin-right: 20px;
    }
    .header-content {
      flex-grow: 1;
    }
    .document-title {
      font-size: 14pt;
      font-weight: bold;
      margin: 5px 0;
      text-align: center;
      color: #000;
    }
    .client-info-container {
      display: flex;
      margin-bottom: 20px;
    }
    .client-info {
      flex: 1;
      padding: 10px;
      margin-right: 20px;
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
      margin-top: 15px;
      display: inline-block;
      width: auto;
      min-width: 50%;
    }
    .footer-container {
      position: absolute;
      bottom: 0;
      width: 100%;
    }
    .tagline {
      text-align: center;
      font-weight: bold;
      font-size: 12pt;
      margin: 20px 0 10px 0;
      color: #333;
    }
    .footer {
      font-size: 9pt;
      color: #777;
      text-align: center;
      border-top: 1px solid #ddd;
      padding-top: 10px;
      margin-top: 10px;
    }
    .prepared-by {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #ddd;
      margin-bottom: 60px;
    }
    .prepared-by-name {
      font-weight: bold;
      margin-top: 20px;
    }
    .prepared-by-title {
      font-size: 9pt;
      color: #777;
    }
  </style>
</head>
<body>
  <div class="header">
    <img class="logo" src="https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/sample-spmc/logo+(1).png" alt="Company Logo">
    <div class="header-content">
      <div class="document-title">QUOTE</div>
    </div>
  </div>

  <div class="client-info-container">
    <div class="client-info">
      <p><strong>Client:</strong> ${client.clientName || "N/A"}</p>
      <p><strong>Address:</strong> ${client.clientAddress || "N/A"}</p>
      <p><strong>Contact:</strong> ${client.mobileNumber || client.telephoneNumber || "N/A"}</p>
      <p><strong>Email:</strong> ${client.email || "N/A"}</p>
      <p><strong>Site:</strong> ${site}</p>
      <p><strong>Subject:</strong> ${project.projectName || "N/A"}</p>
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
            <td class="text-center">
              ${item.image?.url ? `<img src="${item.image.url}" style="max-height: 50px; max-width: 100px;"/>` : ""}
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
  <div class="section">
    <div class="section-title">TERMS & CONDITIONS</div>
    <div class="terms-box">
      <ol>
        ${quotation.termsAndConditions.map(term => `<li>${term}</li>`).join("")}
      </ol>
    </div>
  </div>
  ` : ''}

  <div class="prepared-by">
    <div class="section-title">PREPARED BY</div>
    <div class="prepared-by-name">${preparedBy?.firstName || "N/A"} ${preparedBy?.lastName || ""}</div>
    ${preparedBy?.phoneNumbers?.length ? `
    <div class="prepared-by-title">Phone: ${preparedBy.phoneNumbers.join(", ")}</div>
    ` : ''}
  </div>

  <div class="footer-container">
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
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=quotation-${quotation.quotationNumber}.pdf`);
        res.send(pdfBuffer);
    }
    catch (error) {
        console.error("PDF generation error:", error);
        throw new apiHandlerHelpers_2.ApiError(500, "Failed to generate PDF");
    }
    finally {
        await browser.close();
    }
});
//# sourceMappingURL=quotationController.js.map