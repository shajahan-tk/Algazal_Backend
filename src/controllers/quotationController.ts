import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Quotation } from "../models/quotationModel";
import { IProject, Project } from "../models/projectModel";
import { Estimation } from "../models/estimationModel";
import { uploadItemImage, deleteFileFromS3, uploadWorkCompletionImagesToS3 } from "../utils/uploadConf";
import puppeteer from "puppeteer";
import { generateRelatedDocumentNumber } from "../utils/documentNumbers";
import { IUser } from "../models/userModel";
import { IClient } from "../models/clientModel";
import { Types } from "mongoose";

export const createQuotation = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      project: projectId,
      validUntil,
      scopeOfWork = [],
      items = [],
      termsAndConditions = [],
      vatPercentage = 5,
    } = req.body;

    // Validate items is an array
    if (!Array.isArray(items)) {
      throw new ApiError(400, "Items must be an array");
    }

    // Check for existing quotation
    const exists = await Quotation.findOne({ project: projectId });
    if (exists) throw new ApiError(400, "Project already has a quotation");

    const estimation = await Estimation.findOne({ project: projectId });
    const estimationId = estimation?._id;

    // Calculate item totals (no image processing)
    const processedItems = items.map((item: any) => {
      item.totalPrice = item.quantity * item.unitPrice;
      return item;
    });

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
      images: [], // Start with empty images array
      termsAndConditions,
      vatPercentage,
      subtotal,
      vatAmount,
      netAmount: total,
      preparedBy: req.user?.userId,
    });

    await Project.findByIdAndUpdate(projectId, { status: "quotation_sent" });

    const populatedQuotation = await Quotation.findById(quotation._id)
      .populate("project", "projectName")
      .populate("preparedBy", "firstName lastName");

    res.status(201).json(new ApiResponse(201, populatedQuotation, "Quotation created"));
  }
);


export const replaceQuotationImage = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, imageId } = req.params;
    const file = req.file as Express.Multer.File;

    if (!id || !imageId) {
      throw new ApiError(400, "Quotation ID and image ID are required");
    }

    if (!file) {
      throw new ApiError(400, "No image file provided");
    }

    const quotation = await Quotation.findById(id);
    if (!quotation) {
      throw new ApiError(404, "Quotation not found");
    }

    // Check if user is authorized to update this quotation
    if (quotation.preparedBy.toString() !== req.user?.userId.toString()) {
      throw new ApiError(403, "Not authorized to update this quotation");
    }

    const imageIndex = quotation.images.findIndex(
      (img) => img._id.toString() === imageId
    );

    if (imageIndex === -1) {
      throw new ApiError(404, "Image not found");
    }

    const oldImage = quotation.images[imageIndex];

    // Upload new image
    const uploadResult = await uploadWorkCompletionImagesToS3([file]);

    if (!uploadResult.success || !uploadResult.uploadData?.[0]) {
      throw new ApiError(500, "Failed to upload new image to S3");
    }

    const newImageData = uploadResult.uploadData[0];

    // Delete old image from S3
    if (oldImage.s3Key) {
      await deleteFileFromS3(oldImage.s3Key);
    }

    // Update image with new file
    quotation.images[imageIndex].imageUrl = newImageData.url;
    quotation.images[imageIndex].s3Key = newImageData.key;
    quotation.images[imageIndex].uploadedAt = new Date();

    await quotation.save();

    const updatedQuotation = await Quotation.findById(id)
      .populate("project", "projectName")
      .populate("preparedBy", "firstName lastName");

    res
      .status(200)
      .json(new ApiResponse(200, updatedQuotation, "Image replaced successfully"));
  }
);

export const uploadQuotationImages = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const files = req.files as Express.Multer.File[];
    const { titles = [] } = req.body; // Remove descriptions

    if (!id) {
      throw new ApiError(400, "Quotation ID is required");
    }

    if (!files || files.length === 0) {
      throw new ApiError(400, "No images uploaded");
    }

    if (!req.user?.userId) {
      throw new ApiError(401, "Unauthorized");
    }

    const titlesArray: string[] = Array.isArray(titles) ? titles : [titles];

    if (titlesArray.length !== files.length) {
      throw new ApiError(400, "Number of titles must match number of images");
    }

    if (titlesArray.some((title) => !title?.trim())) {
      throw new ApiError(400, "All images must have a non-empty title");
    }

    const quotation = await Quotation.findById(id);
    if (!quotation) {
      throw new ApiError(404, "Quotation not found");
    }

    // Check if user is authorized to update this quotation
    if (quotation.preparedBy.toString() !== req.user.userId.toString()) {
      throw new ApiError(403, "Not authorized to update this quotation");
    }

    const uploadResults = await uploadWorkCompletionImagesToS3(files);

    if (!uploadResults.success || !uploadResults.uploadData) {
      throw new ApiError(500, "Failed to upload images to S3");
    }

    const newImages: any[] = uploadResults.uploadData.map(
      (fileData, index) => {
        const imageData: any = {
          _id: new Types.ObjectId(),
          title: titlesArray[index],
          imageUrl: fileData.url,
          s3Key: fileData.key,
          uploadedAt: new Date(),
        };

        return imageData;
      }
    );

    quotation.images.push(...newImages);
    await quotation.save();

    const updatedQuotation = await Quotation.findById(id)
      .populate("project", "projectName")
      .populate("preparedBy", "firstName lastName");

    res
      .status(200)
      .json(new ApiResponse(200, updatedQuotation, "Images uploaded successfully"));
  }
);

export const updateQuotationImage = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, imageId } = req.params;
    const { title } = req.body; // Remove description

    if (!id || !imageId) {
      throw new ApiError(400, "Quotation ID and image ID are required");
    }

    const quotation = await Quotation.findById(id);
    if (!quotation) {
      throw new ApiError(404, "Quotation not found");
    }

    // Check if user is authorized to update this quotation
    if (quotation.preparedBy.toString() !== req.user?.userId.toString()) {
      throw new ApiError(403, "Not authorized to update this quotation");
    }

    const imageIndex = quotation.images.findIndex(
      (img) => img._id.toString() === imageId
    );

    if (imageIndex === -1) {
      throw new ApiError(404, "Image not found");
    }

    // Update image fields - only title
    if (title !== undefined) {
      if (!title?.trim()) {
        throw new ApiError(400, "Title cannot be empty");
      }
      quotation.images[imageIndex].title = title.trim();
    }

    await quotation.save();

    const updatedQuotation = await Quotation.findById(id)
      .populate("project", "projectName")
      .populate("preparedBy", "firstName lastName");

    res
      .status(200)
      .json(new ApiResponse(200, updatedQuotation, "Image updated successfully"));
  }
);

export const getQuotationImages = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
      throw new ApiError(400, "Quotation ID is required");
    }

    const quotation = await Quotation.findById(id).select("images");

    if (!quotation) {
      throw new ApiError(404, "Quotation not found");
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          quotation.images,
          "Quotation images retrieved successfully"
        )
      );
  }
);

export const deleteQuotationImage = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, imageId } = req.params;

    if (!id || !imageId) {
      throw new ApiError(400, "Quotation ID and image ID are required");
    }

    const quotation = await Quotation.findById(id);
    if (!quotation) {
      throw new ApiError(404, "Quotation not found");
    }

    if (quotation.preparedBy.toString() !== req.user?.userId.toString()) {
      throw new ApiError(403, "Not authorized to modify this quotation");
    }

    const imageIndex = quotation.images.findIndex(
      (img) => img._id.toString() === imageId
    );

    if (imageIndex === -1) {
      throw new ApiError(404, "Image not found");
    }

    const imageToDelete = quotation.images[imageIndex];
    const deleteResult = await deleteFileFromS3(imageToDelete.s3Key);

    if (!deleteResult.success) {
      throw new ApiError(500, "Failed to delete image from S3");
    }

    quotation.images.splice(imageIndex, 1);
    await quotation.save();

    const updatedQuotation = await Quotation.findById(id)
      .populate("project", "projectName")
      .populate("preparedBy", "firstName lastName");

    res
      .status(200)
      .json(new ApiResponse(200, updatedQuotation, "Image deleted successfully"));
  }
);

export const getQuotationByProject = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const quotation = await Quotation.findOne({ project: projectId })
      .populate("project", "projectName location")
      .populate("preparedBy", "firstName lastName");

    if (!quotation) throw new ApiError(404, "Quotation not found");
    res
      .status(200)
      .json(new ApiResponse(200, quotation, "Quotation retrieved"));
  }
);

export const updateQuotation = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
      items = [],
      validUntil,
      scopeOfWork,
      termsAndConditions,
      vatPercentage,
    } = req.body;

    // Validate items is an array
    if (!Array.isArray(items)) {
      throw new ApiError(400, "Items must be an array");
    }

    const quotation = await Quotation.findById(id);
    if (!quotation) throw new ApiError(404, "Quotation not found");

    // Calculate item totals (no image processing)
    const processedItems = items.map((item: any) => {
      item.totalPrice = item.quantity * item.unitPrice;
      return item;
    });

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

    const updatedQuotation = await Quotation.findById(id)
      .populate("project", "projectName")
      .populate("preparedBy", "firstName lastName");

    res.status(200).json(new ApiResponse(200, updatedQuotation, "Quotation updated"));
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
    ).populate("project", "projectName")
      .populate("preparedBy", "firstName lastName");

    if (!quotation) {
      throw new ApiError(404, "Quotation not found");
    }

    await Project.findByIdAndUpdate(quotation.project, {
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
    const quotation = await Quotation.findById(id);

    if (!quotation) throw new ApiError(404, "Quotation not found");

    // Delete all associated images from S3
    if (quotation.images && quotation.images.length > 0) {
      await Promise.all(
        quotation.images.map((image) =>
          image.s3Key ? deleteFileFromS3(image.s3Key) : Promise.resolve()
        )
      );
    }

    await Quotation.findByIdAndDelete(id);

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
      .populate<{ project: IProject & { client: IClient } }>(
        {
          path: "project",
          select:
            "projectName client siteAddress location building apartmentNumber attention",
          populate: {
            path: "client",
            select:
              "clientName clientAddress mobileNumber telephoneNumber email",
          },
        }
      )
      .populate<{ preparedBy: IUser }>(
        "preparedBy",
        "firstName lastName phoneNumbers"
      );

    if (!quotation) throw new ApiError(404, "Quotation not found");

    if (
      !quotation.project ||
      typeof quotation.project !== "object" ||
      !("client" in quotation.project)
    ) {
      throw new ApiError(400, "Client information not found");
    }

    const client = quotation.project.client as IClient;
    const preparedBy = quotation.preparedBy as IUser;
    const project = quotation.project;

    const site = `${project.location} ${project.building} ${project.apartmentNumber}`;

    const subtotal = quotation.items.reduce(
      (sum, item) => sum + item.totalPrice,
      0
    );
    const vatAmount = subtotal * (quotation.vatPercentage / 100);
    const netAmount = subtotal + vatAmount;

    const formatDate = (date: Date) => {
      return date
        ? new Date(date).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "";
    };

    const getDaysRemaining = (validUntil: Date) => {
      if (!validUntil) return "N/A";
      const today = new Date();
      const validDate = new Date(validUntil);
      const diff = validDate.getTime() - today.getTime();
      const days = Math.ceil(diff / (1000 * 3600 * 24));
      return days > 0 ? `${days} days` : "Expired";
    };

    const cleanDescription = (desc: string) =>
      desc.replace(/\n\n+/g, "\n").trim();

    const formatCurrency = (n: number) =>
      n.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, "$&,");

    let htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<style type="text/css">

@page {
  size: A4;
  margin: 0.3cm;
}

body {
  font-family: 'Arial', sans-serif;
  font-size: 10pt;
  line-height: 1.3;
  color: #333;
  margin: 0;
  padding: 0;
}

.container {
  display: block;
  width: 100%;
  max-width: 100%;
}

/* ==================== HEADER ==================== */

.header {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
  gap: 15px;
  page-break-after: avoid;
  padding: 8px 0;
  border-bottom: 2px solid #94d7f4;
  position: relative;
}

.logo {
  height: 40px;
  width: auto;
  max-width: 120px;
  object-fit: contain;
  position: absolute;
  left: 0;
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
  font-size: 16pt;
  font-weight: bold;
  color: #1a1a1a;
  line-height: 1.2;
  direction: rtl;
  unicode-bidi: bidi-override;
  letter-spacing: 0;
  margin-bottom: 3px;
}

.company-name-english {
  font-size: 9pt;
  font-weight: bold;
  color: #1a1a1a;
  line-height: 1.2;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ==================== CLIENT INFO ==================== */

.client-info-container {
  display: flex;
  margin-bottom: 6px;
  gap: 12px;
  page-break-after: avoid;
}

.client-info {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 9pt;
  background-color: #f8f9fa;
}

.client-info p {
  margin: 3px 0;
  line-height: 1.2;
}

.client-info strong {
  font-weight: 600;
  color: #2c3e50;
}

.quotation-info {
  width: 200px;
}

.quotation-details {
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
}

.quotation-details tr:not(:last-child) {
  border-bottom: 1px solid #eee;
}

.quotation-details td {
  padding: 4px 6px;
  vertical-align: top;
}

.quotation-details td:first-child {
  font-weight: bold;
  width: 40%;
  color: #2c3e50;
}

/* ==================== SUBJECT ==================== */

.subject-section {
  margin: 6px 0;
  padding: 6px 12px;
  background-color: #f8f9fa;
  border-radius: 3px;
  page-break-after: avoid;
  page-break-inside: avoid;
  border-left: 4px solid #94d7f4;
  border-right: 4px solid #94d7f4;
  background: linear-gradient(to right, #f0f8ff 0%, #f8f9fa 50%, #f0f8ff 100%);
}

.subject-title {
  font-weight: bold;
  font-size: 9.5pt;
  margin-bottom: 3px;
  color: #2c5aa0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.subject-content {
  font-size: 9pt;
  color: #333;
  font-weight: 500;
  padding-left: 4px;
}

/* ==================== ITEMS TABLE ==================== */

.section {
  margin-bottom: 8px;
  page-break-inside: avoid;
}

.section-title {
  font-size: 10pt;
  font-weight: bold;
  padding: 3px 0;
  margin: 6px 0 4px 0;
  border-bottom: 1px solid #94d7f4;
  page-break-after: avoid;
  color: #2c3e50;
}

.table-container {
  page-break-inside: avoid;
  overflow: visible;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 8px;
  page-break-inside: avoid;
  font-size: 9pt;
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
}

th, td {
  page-break-inside: avoid;
}

th {
  background-color: #94d7f4;
  color: #000;
  font-weight: bold;
  padding: 4px 5px;
  text-align: center;
  border: 1px solid #ddd;
  font-size: 9pt;
  vertical-align: middle;
}

td {
  padding: 4px 5px;
  border: 1px solid #ddd;
  vertical-align: top;
  font-size: 9pt;
}

.col-desc {
  white-space: pre-wrap;
  line-height: 1.2;
}

.col-no { width: 5%; }
.col-desc { width: 45%; }
.col-uom { width: 10%; }
.col-qty { width: 10%; }
.col-unit { width: 15%; }
.col-total { width: 15%; }

/* ==================== TOTALS ==================== */

.amount-summary {
  margin-top: 6px;
  width: 100%;
  text-align: right;
  page-break-inside: avoid;
  font-size: 9.5pt;
}

.amount-summary-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 3px;
  align-items: center;
}

.amount-label {
  font-weight: bold;
  text-align: left;
  font-size: 9pt;
  min-width: 120px;
}

.amount-value {
  text-align: right;
  font-size: 9pt;
  font-weight: normal;
  font-family: 'Arial', sans-serif;
  min-width: 150px;
  white-space: nowrap;
}

.net-amount-row {
  display: flex;
  justify-content: space-between;
  background-color: #94d7f4;
  color: #000;
  font-weight: bold;
  font-size: 9.5pt;
  margin-top: 3px;
  padding: 4px 8px;
  border-top: 1px solid #333;
  border-radius: 3px;
}

.net-amount-row .amount-value {
  font-weight: bold;
  font-family: 'Arial', sans-serif;
}

/* ==================== IMAGE SECTION (FIXED - NO BREAK PROBLEMS) ==================== */

.images-section {
  margin-top: 8px;
  /* REMOVED: page-break-inside: avoid - Let it break naturally */
}

.images-grid {
  display: block;
  margin-top: 4px;
  /* REMOVED: page-break-inside rules - Let it flow naturally */
}

.images-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  /* REMOVED ALL page-break rules - Let rows break naturally between pages */
  min-height: 140px; /* Ensure minimum height for better breaking */
}

.image-item {
  flex: 1;
  min-width: calc(33.333% - 6px);
  max-width: calc(33.333% - 6px);
  display: flex;
  flex-direction: column;
  align-items: center;
  /* REMOVED: page-break-inside: avoid - Let items break naturally */
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 6px;
  background: #fafafa;
  min-height: 140px;
  box-sizing: border-box;
  /* Allow breaking inside image items if needed */
  page-break-inside: auto;
}

.image-container {
  width: 100%;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  margin-bottom: 4px;
  background: #fff;
  border-radius: 3px;
  /* Prevent images from breaking */
  page-break-inside: avoid;
  break-inside: avoid;
}

.image-container img {
  max-height: 100%;
  max-width: 100%;
  object-fit: contain;
  /* Ensure images don't break */
  page-break-inside: avoid;
  break-inside: avoid;
}

.image-title {
  font-size: 8pt;
  font-weight: 600;
  text-align: center;
  color: #2c3e50;
  line-height: 1.1;
  margin: 0;
  word-break: break-word;
  max-height: 28px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  /* Allow title to break with the image */
  page-break-inside: auto;
}

/* ==================== TERMS & PREPARED BY ==================== */

.terms-prepared-section {
  margin-top: 8px;
  page-break-inside: avoid;
}

.terms-prepared-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 3px;
  border-bottom: 1px solid #94d7f4;
  margin-bottom: 6px;
  page-break-after: avoid;
}

.terms-title, .prepared-title {
  font-size: 9.5pt;
  font-weight: bold;
  margin: 0;
  color: #2c3e50;
}

.terms-prepared-content {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.terms-content {
  flex: 1;
}

.prepared-content {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 9pt;
}

.terms-box {
  border: 1px solid #000;
  padding: 6px 8px;
  width: 100%;
  box-sizing: border-box;
  font-size: 9pt;
  line-height: 1.3;
}

.terms-box ol {
  margin: 0;
  padding-left: 12px;
}

.terms-box li {
  margin-bottom: 3px;
}

.prepared-by-name {
  font-weight: bold;
  margin-top: 3px;
  font-size: 9.5pt;
  color: #2c3e50;
}

.prepared-by-title {
  font-size: 8.5pt;
  color: #555;
  margin-top: 2px;
}

/* ==================== FOOTER ==================== */

.tagline {
  text-align: center;
  font-weight: bold;
  font-size: 10pt;
  margin: 10px 0 6px 0;
  color: #2c3e50;
  border-top: 1px solid #ddd;
  padding-top: 6px;
  page-break-before: avoid;
}

.footer {
  font-size: 8pt;
  color: #555;
  text-align: center;
  margin-top: 6px;
  page-break-inside: avoid;
  line-height: 1.2;
}

.footer p {
  margin: 3px 0;
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
  margin: 3px 0;
  line-height: 1.2;
}

strong {
  font-weight: 600;
}

.no-break {
  page-break-inside: avoid;
}

.compact {
  margin-bottom: 6px;
}

</style>
</head>
<body>

<div class="container">
  <div class="content">
    <!-- HEADER SECTION -->
    <div class="header-section no-break">
      <div class="header">
        <img class="logo" src="https://agats.s3.ap-south-1.amazonaws.com/logo/alghlogo.jpg" alt="Company Logo">
        <div class="company-names">
          <div class="company-name-arabic">الغزال الأبيض للخدمات الفنية</div>
          <div class="company-name-english">AL GHAZAL AL ABYAD TECHNICAL SERVICES</div>
        </div>
      </div>

      <!-- CLIENT INFO -->
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

      <!-- SUBJECT -->
      <div class="subject-section">
        <div class="subject-title">SUBJECT</div>
        <div class="subject-content">${project.projectName || "N/A"}</div>
      </div>
    </div>

    <!-- ITEMS SECTION -->
    <div class="section no-break">
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
              <th class="col-total">Total (AED)</th>
            </tr>
          </thead>
          <tbody>
            ${quotation.items.map((item, index) => `
              <tr>
                <td class="text-center col-no">${index + 1}</td>
                <td class="col-desc">${cleanDescription(item.description)}</td>
                <td class="text-center col-uom">${item.uom || "NOS"}</td>
                <td class="text-center col-qty">${item.quantity.toFixed(2)}</td>
                <td class="text-right col-unit">${formatCurrency(item.unitPrice)}</td>
                <td class="text-right col-total">${formatCurrency(item.totalPrice)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="amount-summary">
        <div class="amount-summary-row">
          <div class="amount-label">SUBTOTAL:</div>
          <div class="amount-value">${formatCurrency(subtotal)} AED</div>
        </div>
        <div class="amount-summary-row">
          <div class="amount-label">VAT ${quotation.vatPercentage}%:</div>
          <div class="amount-value">${formatCurrency(vatAmount)} AED</div>
        </div>
        <div class="net-amount-row">
          <div class="amount-label">NET AMOUNT:</div>
          <div class="amount-value">${formatCurrency(netAmount)} AED</div>
        </div>
      </div>
    </div>

    <!-- IMAGES SECTION -->
    ${
      quotation.images.length > 0 ? `
      <div class="images-section">
        <div class="section-title">QUOTATION IMAGES</div>
        <div class="images-grid">
          ${(() => {
            let html = '';
            for (let i = 0; i < quotation.images.length; i += 3) {
              const rowImages = quotation.images.slice(i, i + 3);
              html += '<div class="images-row">';
              
              for (let j = 0; j < 3; j++) {
                if (j < rowImages.length) {
                  const image = rowImages[j];
                  html += `
                    <div class="image-item">
                      <div class="image-container">
                        <img src="${image.imageUrl}" alt="${image.title}" />
                      </div>
                      <div class="image-title">${image.title}</div>
                    </div>
                  `;
                } else {
                  html += `
                    <div class="image-item" style="visibility: hidden;">
                      <div class="image-container"></div>
                      <div class="image-title"></div>
                    </div>
                  `;
                }
              }
              html += '</div>';
            }
            return html;
          })()}
        </div>
      </div>
      ` : ''
    }

    <!-- TERMS & PREPARED BY SECTION -->
    ${
      quotation.termsAndConditions.length > 0 ? `
      <div class="terms-prepared-section no-break">
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
      <div class="section no-break">
        <div class="section-title">PREPARED BY</div>
        <div class="prepared-content">
          <div class="prepared-by-name">${preparedBy?.firstName || "N/A"} ${preparedBy?.lastName || ""}</div>
          ${preparedBy?.phoneNumbers?.length ? `
          <div class="prepared-by-title">Phone: ${preparedBy.phoneNumbers.join(", ")}</div>
          ` : ''}
        </div>
      </div>
      `
    }
  </div>

  <!-- FOOTER -->
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
          top: "0.3cm",
          right: "0.3cm",
          bottom: "0.3cm",
          left: "0.3cm",
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
    } catch (err) {
      console.error("PDF generation error:", err);
      throw new ApiError(500, "Failed to generate PDF");
    } finally {
      await browser.close();
    }
  }
);