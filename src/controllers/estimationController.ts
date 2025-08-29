import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Estimation, IEstimation } from "../models/estimationModel";
import { IProject, Project } from "../models/projectModel";
import { Types } from "mongoose";
import puppeteer from "puppeteer";
import { Client, IClient } from "../models/clientModel";
import { Comment } from "../models/commentModel";
import { IUser, User } from "../models/userModel";
import { mailer } from "../utils/mailer";
import { generateRelatedDocumentNumber } from "../utils/documentNumbers";
import { EstimationTemplateParams } from "../template/estimationCheckedEmailTemplate";
import { FRONTEND_URL } from "../config/constant";
import { Quotation } from "../models/quotationModel";

export const createEstimation = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      project,
      workStartDate,
      workEndDate,
      validUntil,
      paymentDueBy,
      materials,
      labour,
      termsAndConditions,
      commissionAmount,
      subject,
    } = req.body;

    // Validate required fields
    if (
      !project ||
      !workStartDate ||
      !workEndDate ||
      !validUntil ||
      !paymentDueBy
    ) {
      throw new ApiError(400, "Required fields are missing");
    }

    // Check if an estimation already exists for this project
    const existingEstimation = await Estimation.findOne({ project });
    if (existingEstimation) {
      throw new ApiError(
        400,
        "Only one estimation is allowed per project. Update the existing estimation instead."
      );
    }

    // Validate materials (now with UOM)
    if (materials && materials.length > 0) {
      for (const item of materials) {
        if (
          !item.description ||
          !item.uom ||
          item.quantity == null ||
          item.unitPrice == null
        ) {
          throw new ApiError(
            400,
            "Material items require description, uom, quantity, and unitPrice"
          );
        }
        item.total = item.quantity * item.unitPrice;
      }
    }

    // Validate labour
    if (labour && labour.length > 0) {
      for (const item of labour) {
        if (!item.designation || item.days == null || item.price == null) {
          throw new ApiError(
            400,
            "Labour items require designation, days, and price"
          );
        }
        item.total = item.days * item.price;
      }
    }

    // Validate terms (now with UOM)
    if (termsAndConditions && termsAndConditions.length > 0) {
      for (const item of termsAndConditions) {
        if (
          !item.description ||
          item.quantity == null ||
          item.unitPrice == null
        ) {
          throw new ApiError(
            400,
            "Terms items require description, uom, quantity, and unitPrice"
          );
        }
        item.total = item.quantity * item.unitPrice;
      }
    }

    // At least one item is required
    if (
      (!materials || materials.length === 0) &&
      (!labour || labour.length === 0) &&
      (!termsAndConditions || termsAndConditions.length === 0)
    ) {
      throw new ApiError(
        400,
        "At least one item (materials, labour, or terms) is required"
      );
    }

    const estimation = await Estimation.create({
      project,
      estimationNumber: await generateRelatedDocumentNumber(project, "EST"),
      workStartDate: new Date(workStartDate),
      workEndDate: new Date(workEndDate),
      validUntil: new Date(validUntil),
      paymentDueBy,
      materials: materials || [],
      labour: labour || [],
      termsAndConditions: termsAndConditions || [],
      commissionAmount,
      preparedBy: req.user?.userId,
      subject: subject,
    });

    await Project.findByIdAndUpdate(project, {
      status: "estimation_prepared",
    });

    res
      .status(201)
      .json(
        new ApiResponse(201, estimation, "Estimation created successfully")
      );
  }
);

export const approveEstimation = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { comment, isApproved } = req.body;
    const userId = req.user?.userId;

    // Validate input
    if (!userId) throw new ApiError(401, "Unauthorized");
    if (typeof isApproved !== "boolean") {
      throw new ApiError(400, "isApproved must be a boolean");
    }

    // Convert userId to ObjectId
    const userIdObject = new Types.ObjectId(userId);

    // Define populated types
    type PopulatedEstimation = Omit<IEstimation, "project"> & {
      project: IProject;
    };

    type PopulatedProject = Omit<IProject, "assignedTo"> & {
      assignedTo?: {
        _id: Types.ObjectId;
        email?: string;
        firstName?: string;
        lastName?: string;
      };
    };

    const estimation = await Estimation.findById(id).populate<{
      project: IProject;
    }>("project");
    if (!estimation) throw new ApiError(404, "Estimation not found");

    // Check prerequisites
    if (!estimation.isChecked) {
      throw new ApiError(
        400,
        "Estimation must be checked before approval/rejection"
      );
    }
    if (estimation.isApproved && isApproved) {
      throw new ApiError(400, "Estimation is already approved");
    }

    // Create activity log
    await Comment.create({
      content: comment || `Estimation ${isApproved ? "approved" : "rejected"}`,
      user: userIdObject,
      project: estimation.project,
      actionType: isApproved ? "approval" : "rejection",
    });

    // Update estimation
    estimation.isApproved = isApproved;
    estimation.approvedBy = isApproved ? userIdObject : undefined;
    estimation.approvalComment = comment;
    await estimation.save();

    // Update project status
    await Project.findByIdAndUpdate(estimation.project, {
      status: isApproved ? "quotation_approved" : "quotation_rejected",
      updatedBy: userIdObject,
    });

    try {
      // Get all recipients (assigned engineer + admins + super_admins)
      const project = await Project.findById(estimation.project).populate<{
        assignedTo: Pick<IUser, "_id" | "email" | "firstName" | "lastName">;
      }>("assignedTo", "email firstName lastName");

      const assignedEngineer = project?.assignedTo;

      const admins = await User.find({
        role: { $in: ["admin", "super_admin"] },
        email: { $exists: true, $ne: "" },
      });

      // Get the user who performed the approval
      const approver = await User.findById(userIdObject);

      // Prepare recipient list
      const recipients = [];

      // Add assigned engineer if exists
      if (assignedEngineer?.email) {
        recipients.push({
          email: assignedEngineer.email,
          name: assignedEngineer.firstName || "Engineer",
        });
      }

      // Add admins and super admins
      admins.forEach((admin) => {
        recipients.push({
          email: admin.email,
          name: admin.firstName || "Admin",
        });
      });

      // Remove duplicates
      const uniqueRecipients = recipients.filter(
        (recipient, index, self) =>
          index === self.findIndex((r) => r.email === recipient.email)
      );

      // Prepare email content
      const templateParams: EstimationTemplateParams = {
        userName: "Team",
        actionUrl: `${FRONTEND_URL}/app/project-view/${estimation.project._id}`,
        contactEmail: "info@alghzal.ae",
        logoUrl:
          "https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo+alghazal.png",
        estimationNumber: estimation.estimationNumber,
        checkerName: approver
          ? `${approver.firstName} ${approver.lastName}`
          : "an approver",
        projectName: estimation.project.projectName || "the project",
        dueDate: estimation.validUntil?.toLocaleDateString(),
      };

      // Send email to all recipients
      await mailer.sendEmail({
        to: process.env.NOTIFICATION_INBOX || "notifications@company.com",
        bcc: uniqueRecipients.map((r) => r.email).join(","),
        subject: `Estimation ${isApproved ? "Approved" : "Rejected"}: ${
          estimation.estimationNumber
        }`,
        templateParams: templateParams, // Just pass the templateParams without content
        text: `Dear Team,\n\nEstimation ${
          estimation.estimationNumber
        } for project ${templateParams.projectName} has been ${
          isApproved ? "approved" : "rejected"
        } by ${templateParams.checkerName}.\n\nView project: ${
          templateParams.actionUrl
        }\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
        headers: {
          "X-Priority": "1",
          Importance: "high",
        },
      });
    } catch (emailError) {
      console.error("Failed to send notification emails:", emailError);
      // Continue even if email fails
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          estimation,
          `Estimation ${isApproved ? "approved" : "rejected"} successfully`
        )
      );
  }
);

export const markAsChecked = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { comment, isChecked } = req.body;
    const userId = req.user?.userId;

    // Validate input
    if (!userId) throw new ApiError(401, "Unauthorized");
    if (typeof isChecked !== "boolean") {
      throw new ApiError(400, "isChecked must be a boolean");
    }

    const estimation = await Estimation.findById(id).populate("project");
    if (!estimation) throw new ApiError(404, "Estimation not found");

    // Check prerequisites
    if (estimation.isChecked && isChecked) {
      throw new ApiError(400, "Estimation is already checked");
    }

    // Convert userId to ObjectId
    const userIdObject = new Types.ObjectId(userId);

    // Create activity log
    await Comment.create({
      content:
        comment ||
        `Estimation ${isChecked ? "checked" : "rejected during check"}`,
      user: userIdObject,
      project: estimation.project,
      actionType: isChecked ? "check" : "rejection",
    });

    // Update estimation
    estimation.isChecked = isChecked;
    estimation.checkedBy = isChecked ? userIdObject : undefined;
    if (comment) estimation.approvalComment = comment;
    await estimation.save();

    // Update project status if rejected
    if (!isChecked) {
      await Project.findByIdAndUpdate(estimation.project, {
        status: "draft",
        updatedBy: userIdObject,
      });
    }

    // Send email to admins if checked
    if (isChecked) {
      try {
        // Find all admin and super_admin users
        const admins = await User.find({
          role: { $in: ["admin", "super_admin"] },
          email: { $exists: true, $ne: "" },
        });

        // Get the user who performed the check
        const checkedByUser = await User.findById(userIdObject);

        // Prepare common email content
        const project = estimation.project as any;
        const templateParams: EstimationTemplateParams = {
          userName: "Team",
          actionUrl: `${FRONTEND_URL}/app/project-view/${estimation.project._id}`,
          contactEmail: "info@alghazal.ae",
          logoUrl:
            "https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo+alghazal.png",
          estimationNumber: estimation.estimationNumber,
          checkerName: checkedByUser
            ? `${checkedByUser.firstName} ${checkedByUser.lastName}`
            : "a team member",
          projectName: project?.projectName || "the project",
          dueDate: estimation.validUntil?.toLocaleDateString(),
        };

        // Send single email to all admins (BCC to hide recipient list)
        await mailer.sendEmail({
          to: process.env.NOTIFICATION_INBOX || "notifications@company.com",
          bcc: admins.map((admin) => admin.email).join(","),
          subject: `Estimation Checked: ${estimation.estimationNumber}`,
          templateParams,
          text: `Dear Team,\n\nEstimation ${estimation.estimationNumber} for project ${templateParams.projectName} has been checked by ${templateParams.checkerName}.\n\nView project: ${templateParams.actionUrl}\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
          headers: {
            "X-Priority": "1",
            Importance: "high",
          },
        });
      } catch (emailError) {
        console.error("Failed to send notification emails:", emailError);
        // Continue even if email fails
      }
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          estimation,
          `Estimation ${isChecked ? "checked" : "rejected"} successfully`
        )
      );
  }
);
export const getEstimationsByProject = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { status } = req.query;

    const filter: any = { project: projectId };
    if (status === "checked") filter.isChecked = true;
    if (status === "approved") filter.isApproved = true;
    if (status === "pending") filter.isChecked = false;

    const estimations = await Estimation.find(filter)
      .populate("preparedBy", "firstName lastName")
      .populate("checkedBy", "firstName lastName")
      .populate("approvedBy", "firstName lastName")
      .sort({ createdAt: -1 });

    res
      .status(200)
      .json(
        new ApiResponse(200, estimations, "Estimations retrieved successfully")
      );
  }
);

export const getEstimationDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    // Define types for populated fields
    type PopulatedEstimation = Omit<
      IEstimation,
      "project" | "preparedBy" | "checkedBy" | "approvedBy"
    > & {
      project: {
        _id: Types.ObjectId;
        projectName: string;
        client: Types.ObjectId | IClient;
      };
      preparedBy?: {
        _id: Types.ObjectId;
        firstName: string;
        lastName: string;
      };
      checkedBy?: {
        _id: Types.ObjectId;
        firstName: string;
        lastName: string;
      };
      approvedBy?: {
        _id: Types.ObjectId;
        firstName: string;
        lastName: string;
      };
    };

    const estimationE = await Estimation.findById(id)
      .populate<{
        project: { projectName: string; client: Types.ObjectId | IClient };
      }>("project", "projectName client")
      .populate<{ preparedBy: { firstName: string; lastName: string } }>(
        "preparedBy",
        "firstName lastName"
      )
      .populate<{ checkedBy: { firstName: string; lastName: string } }>(
        "checkedBy",
        "firstName lastName"
      )
      .populate<{ approvedBy: { firstName: string; lastName: string } }>(
        "approvedBy",
        "firstName lastName"
      );

    if (!estimationE) {
      throw new ApiError(404, "Estimation not found");
    }

    // Type assertion for the populated estimation
    const populatedEstimation = estimationE as unknown as PopulatedEstimation &
      Document;

    // Get client ID safely
    const clientId = populatedEstimation.project?.client;
    if (!clientId) {
      throw new ApiError(400, "Client information not found");
    }

    const client = await Client.findById(clientId);

    // Prepare response object maintaining the same structure as before
    const estimation = {
      ...populatedEstimation.toObject(), // Using toObject() instead of _doc
      client,
    };

    res
      .status(200)
      .json(new ApiResponse(200, estimation, "Estimation details retrieved"));
  }
);

export const updateEstimation = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;
    console.log(req.body);
    const estimation = await Estimation.findById(id);
    if (!estimation) {
      throw new ApiError(404, "Estimation not found");
    }

    if (estimation.isApproved) {
      throw new ApiError(400, "Cannot update approved estimation");
    }

    // Reset checked status if updating
    if (estimation.isChecked) {
      estimation.isChecked = false;
      estimation.checkedBy = undefined;
      estimation.approvalComment = undefined;
    }

    // Don't allow changing these fields directly
    delete updateData.isApproved;
    delete updateData.approvedBy;
    delete updateData.estimatedAmount;
    delete updateData.profit;

    // Update materials with UOM if present
    if (updateData.materials) {
      for (const item of updateData.materials) {
        if (!item.uom) {
          throw new ApiError(400, "UOM is required for material items");
        }
        if (item.quantity && item.unitPrice) {
          item.total = item.quantity * item.unitPrice;
        }
      }
    }

    // Update labour if present
    if (updateData.labour) {
      for (const item of updateData.labour) {
        if (item.days && item.price) {
          item.total = item.days * item.price;
        }
      }
    }

    // Update fields
    estimation.set(updateData);
    await estimation.save();

    res
      .status(200)
      .json(
        new ApiResponse(200, estimation, "Estimation updated successfully")
      );
  }
);

export const deleteEstimation = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const estimation = await Estimation.findById(id);
    if (!estimation) {
      throw new ApiError(404, "Estimation not found");
    }

    if (estimation.isApproved) {
      throw new ApiError(400, "Cannot delete approved estimation");
    }

    await Estimation.findByIdAndDelete(id);

    res
      .status(200)
      .json(new ApiResponse(200, null, "Estimation deleted successfully"));
  }
);

interface PopulatedEstimationItem {
  description: string;
  uom: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface PopulatedLabourItem {
  designation: string;
  days: number;
  price: number;
  total: number;
}

interface PopulatedTermsItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface PopulatedClient {
  _id: string;
  clientName: string;
  clientAddress: string;
  email: string;
  mobileNumber: string;
  telephoneNumber: string;
}

interface PopulatedProject {
  _id: string;
  projectName: string;
  client: PopulatedClient;
  location: string;
  building: string;
  apartmentNumber: string;
}

interface PopulatedEstimation extends Document {
  project: PopulatedProject;
  estimationNumber: string;
  workStartDate: Date;
  workEndDate: Date;
  validUntil: Date;
  paymentDueBy: number;
  subject?: string;
  materials: PopulatedEstimationItem[];
  labour: PopulatedLabourItem[];
  termsAndConditions: PopulatedTermsItem[];
  estimatedAmount: number;
  commissionAmount?: number;
  profit?: number;
  preparedBy: Pick<IUser, "firstName" | "signatureImage"> | Types.ObjectId;
  checkedBy?: Pick<IUser, "firstName" | "signatureImage"> | Types.ObjectId;
  approvedBy?: Pick<IUser, "firstName" | "signatureImage"> | Types.ObjectId;
  isChecked: boolean;
  isApproved: boolean;
  approvalComment?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const generateEstimationPdf = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const estimation = await Estimation.findById(id)
      .populate<PopulatedEstimation>({
        path: "project",
        select: "projectName client location building apartmentNumber",
        populate: {
          path: "client",
          select: "clientName clientAddress email mobileNumber telephoneNumber",
        },
      })
      .populate("preparedBy", "firstName signatureImage")
      .populate("checkedBy", "firstName signatureImage")
      .populate("approvedBy", "firstName signatureImage");

    if (!estimation) {
      throw new ApiError(404, "Estimation not found");
    }
    const quotation = await Quotation.findOne({ estimation: estimation._id });

    // Verify populated data exists
    if (!estimation.project || !estimation.project.client) {
      throw new ApiError(400, "Client information not found");
    }

    // Type guard to check if populated fields are IUser objects
    const isPopulatedUser = (
      user: any
    ): user is Pick<IUser, "firstName" | "signatureImage"> => {
      return user && typeof user === "object" && "firstName" in user;
    };

    // Get user data with proper typing
    const preparedBy = isPopulatedUser(estimation.preparedBy)
      ? estimation.preparedBy
      : null;
    const checkedBy = isPopulatedUser(estimation.checkedBy)
      ? estimation.checkedBy
      : null;
    const approvedBy = isPopulatedUser(estimation.approvedBy)
      ? estimation.approvedBy
      : null;

    // Calculate totals
    const materialsTotal = estimation.materials.reduce(
      (sum, item) => sum + item.total,
      0
    );
    const labourTotal = estimation.labour.reduce(
      (sum, item) => sum + item.total,
      0
    );
    const termsTotal = estimation.termsAndConditions.reduce(
      (sum, item) => sum + item.total,
      0
    );
    const estimatedAmount = materialsTotal + labourTotal + termsTotal;
    const netAmount = quotation?.netAmount ?? 0;
    const commissionAmount = estimation?.commissionAmount ?? 0;

    let profit = netAmount - estimatedAmount - commissionAmount;
    if (profit < 0) {
      profit = 0;
    }

    // Format dates
    const formatDate = (date?: Date) => {
      return date ? new Date(date).toLocaleDateString("en-GB") : "";
    };

    // Prepare HTML content
    let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', sans-serif;
          color: #333;
          background-color: #fff;
          line-height: 1.5;
          padding: 20px;
        }
        
        .container {
          max-width: 1000px;
          margin: 0 auto;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        
        .header {
          background: linear-gradient(135deg, #0a3041 0%, #1a4d70 100%);
          color: white;
          padding: 25px 30px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        
        .logo-container {
          flex: 1;
        }
        
        .logo {
          max-width: 180px;
          height: auto;
        }
        
        .document-info {
          text-align: right;
        }
        
        .document-title {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 5px;
        }
        
        .document-number {
          font-size: 16px;
          font-weight: 500;
          opacity: 0.9;
        }
        
        .content {
          padding: 30px;
        }
        
        .section {
          margin-bottom: 30px;
        }
        
        .section-title {
          font-size: 18px;
          font-weight: 600;
          color: #0a3041;
          padding-bottom: 10px;
          border-bottom: 2px solid #0a3041;
          margin-bottom: 20px;
        }
        
        .client-info {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 30px;
          margin-bottom: 30px;
        }
        
        .info-card {
          background-color: #f9fafb;
          border-radius: 6px;
          padding: 20px;
          border-left: 4px solid #0a3041;
        }
        
        .info-card h3 {
          font-size: 16px;
          font-weight: 600;
          color: #0a3041;
          margin-bottom: 15px;
        }
        
        .info-item {
          margin-bottom: 8px;
          display: flex;
        }
        
        .info-label {
          font-weight: 500;
          min-width: 120px;
          color: #666;
        }
        
        .info-value {
          font-weight: 400;
          color: #333;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        
        th {
          background-color: #f3f4f6;
          text-align: left;
          padding: 12px 15px;
          font-weight: 600;
          color: #0a3041;
          border-bottom: 2px solid #e5e7eb;
        }
        
        td {
          padding: 12px 15px;
          border-bottom: 1px solid #e5e7eb;
        }
        
        tr:last-child td {
          border-bottom: none;
        }
        
        .text-right {
          text-align: right;
        }
        
        .text-center {
          text-align: center;
        }
        
        .summary-table {
          width: 60%;
          margin-left: auto;
        }
        
        .summary-table td {
          padding: 10px 15px;
        }
        
        .summary-table tr:last-child td {
          border-bottom: 1px solid #e5e7eb;
        }
        
        .total-row {
          font-weight: 600;
          background-color: #f8f9fa;
        }
        
        .profit-row {
          font-weight: 700;
          background-color: #e8f5e9;
          color: #2e7d32;
        }
        
        .signatures {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-top: 40px;
          padding-top: 30px;
          border-top: 1px dashed #ccc;
        }
        
        .signature-box {
          text-align: center;
        }
        
        .signature-line {
          height: 1px;
          background-color: #ccc;
          margin: 40px 0 10px;
        }
        
        .signature-name {
          font-weight: 600;
          color: #0a3041;
        }
        
        .signature-role {
          font-size: 14px;
          color: #666;
        }
        
        .footer {
          margin-top: 40px;
          text-align: center;
          font-size: 14px;
          color: #666;
          padding: 20px;
          border-top: 1px solid #e5e7eb;
        }
        
        .company-info {
          margin-top: 10px;
          font-size: 13px;
        }
        
        .notes {
          background-color: #f9fafb;
          padding: 15px;
          border-radius: 6px;
          margin-top: 30px;
          font-size: 14px;
        }
        
        .notes-title {
          font-weight: 600;
          margin-bottom: 10px;
          color: #0a3041;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-container">
            <img class="logo" src="https://agats.s3.ap-south-1.amazonaws.com/logo/logo.jpeg" alt="Company Logo">
          </div>
          <div class="document-info">
            <div class="document-title">ESTIMATION</div>
            <div class="document-number">Ref: ${estimation.estimationNumber}</div>
          </div>
        </div>
        
        <div class="content">
          <div class="client-info">
            <div class="info-card">
              <h3>CLIENT INFORMATION</h3>
              <div class="info-item">
                <span class="info-label">Name:</span>
                <span class="info-value">${estimation.project.client.clientName}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Address:</span>
                <span class="info-value">${estimation.project.client.clientAddress}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Project:</span>
                <span class="info-value">${estimation.project.location}, ${estimation.project.building}, ${estimation.project.apartmentNumber}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Email:</span>
                <span class="info-value">${estimation.project.client.email}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Phone:</span>
                <span class="info-value">${estimation.project.client.mobileNumber} ${estimation.project.client.telephoneNumber ? '/ ' + estimation.project.client.telephoneNumber : ''}</span>
              </div>
            </div>
            
            <div class="info-card">
              <h3>ESTIMATION DETAILS</h3>
              <div class="info-item">
                <span class="info-label">Date:</span>
                <span class="info-value">${formatDate(new Date())}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Estimation #:</span>
                <span class="info-value">${estimation.estimationNumber}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Payment Terms:</span>
                <span class="info-value">${estimation.paymentDueBy} Days</span>
              </div>
              <div class="info-item">
                <span class="info-label">Subject:</span>
                <span class="info-value">${estimation.subject}</span>
              </div>
            </div>
          </div>
          
          <div class="section">
            <h2 class="section-title">MATERIALS</h2>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>UOM</th>
                  <th class="text-right">Quantity</th>
                  <th class="text-right">Unit Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${estimation.materials
                  .map(
                    (material) => `
                  <tr>
                    <td>${material.description}</td>
                    <td>${material.uom}</td>
                    <td class="text-right">${material.quantity.toFixed(2)}</td>
                    <td class="text-right">${material.unitPrice.toFixed(2)}</td>
                    <td class="text-right">${material.total.toFixed(2)}</td>
                  </tr>
                `
                  )
                  .join("")}
                <tr class="total-row">
                  <td colspan="4" class="text-right">TOTAL MATERIALS</td>
                  <td class="text-right">${materialsTotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="section">
            <h2 class="section-title">LABOR CHARGES</h2>
            <table>
              <thead>
                <tr>
                  <th>Designation</th>
                  <th class="text-right">Qty/Days</th>
                  <th class="text-right">Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${estimation.labour
                  .map(
                    (labour) => `
                  <tr>
                    <td>${labour.designation}</td>
                    <td class="text-right">${labour.days.toFixed(2)}</td>
                    <td class="text-right">${labour.price.toFixed(2)}</td>
                    <td class="text-right">${labour.total.toFixed(2)}</td>
                  </tr>
                `
                  )
                  .join("")}
                <tr class="total-row">
                  <td colspan="3" class="text-right">TOTAL LABOR</td>
                  <td class="text-right">${labourTotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="section">
            <h2 class="section-title">MISCELLANEOUS CHARGES</h2>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th class="text-right">Quantity</th>
                  <th class="text-right">Unit Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${estimation.termsAndConditions
                  .map(
                    (term) => `
                  <tr>
                    <td>${term.description}</td>
                    <td class="text-right">${term.quantity.toFixed(2)}</td>
                    <td class="text-right">${term.unitPrice.toFixed(2)}</td>
                    <td class="text-right">${term.total.toFixed(2)}</td>
                  </tr>
                `
                  )
                  .join("")}
                <tr class="total-row">
                  <td colspan="3" class="text-right">TOTAL MISCELLANEOUS</td>
                  <td class="text-right">${termsTotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="section">
            <h2 class="section-title">SUMMARY</h2>
            <table class="summary-table">
              <tr class="total-row">
                <td>Estimated Amount</td>
                <td class="text-right">${estimatedAmount.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Quotation Amount</td>
                <td class="text-right">${quotation?.netAmount?.toFixed(2) || "0.00"}</td>
              </tr>
              <tr>
                <td>Commission Amount</td>
                <td class="text-right">${estimation.commissionAmount?.toFixed(2) || "0.00"}</td>
              </tr>
              <tr class="profit-row">
                <td>PROFIT</td>
                <td class="text-right">${profit.toFixed(2)}</td>
              </tr>
            </table>
          </div>
          
          <div class="signatures">
            <div class="signature-box">
              <div class="signature-role">Prepared By</div>
              <div class="signature-line"></div>
              <div class="signature-name">${preparedBy?.firstName || "N/A"}</div>
            </div>
            <div class="signature-box">
              <div class="signature-role">Checked By</div>
              <div class="signature-line"></div>
              <div class="signature-name">${checkedBy?.firstName || "N/A"}</div>
            </div>
            <div class="signature-box">
              <div class="signature-role">Approved By</div>
              <div class="signature-line"></div>
              <div class="signature-name">${approvedBy?.firstName || "N/A"}</div>
            </div>
          </div>
          
          <div class="notes">
            <div class="notes-title">Notes:</div>
            <div>This estimation is valid for 30 days from the date of issue. Prices are subject to change without prior notice.</div>
          </div>
        </div>
        
        <div class="footer">
          Thank you for your business!
          <div class="company-info">
            AGATS SOFTWARE CO. LTD. | support@agatsoftware.com | +94 77 123 4567
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

    // Generate PDF
    const browser = await puppeteer.launch({
      headless: "shell",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();

      await page.setViewport({
        width: 1200,
        height: 1800,
        deviceScaleFactor: 1,
      });

      await page.setContent(htmlContent, {
        waitUntil: ["load", "networkidle0", "domcontentloaded"],
        timeout: 30000,
      });

      // Additional wait for dynamic content
      await page.waitForSelector("body", { timeout: 5000 });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "0.1in",
          right: "0.1in",
          bottom: "0.1in",
          left: "0.1in",
        },
        preferCSSPageSize: true,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=estimation-${estimation.estimationNumber}.pdf`
      );
      res.send(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
);