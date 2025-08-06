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
    // console.log(quotation);

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
    if (profit<0) {
      profit=0;
    }
    console.log("profit:", profit);

    // Format dates
    const formatDate = (date?: Date) => {
      return date ? new Date(date).toLocaleDateString("en-GB") : "";
    };
    // const approvedBy = estimation.approvedBy;
    // const checkedBy = estimation.checkedBy;
    // const preparedBy = estimation.preparedBy;

    // Prepare HTML content
    let htmlContent = `
    <!DOCTYPE html>
    <html>
     <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta
      name=""
      content=""
    />
    <meta name="" content="" />
    <style type="text/css">
      html {
        font-family: Calibri, Arial, Helvetica, sans-serif;
        font-size: 11pt;
        background-color: white;
      }
      a.comment-indicator:hover + div.comment {
        background: #ffd;
        position: absolute;
        display: block;
        border: 1px solid black;
        padding: 0.5em;
      }
      a.comment-indicator {
        background: red;
        display: inline-block;
        border: 1px solid black;
        width: 0.5em;
        height: 0.5em;
      }
      td{
        padding-left: 10px;
      }
      div.comment {
        display: none;
      }
      table {
        border-collapse: collapse;
        page-break-after: always;
      }
      .gridlines td {
        border: 1px dotted black;
      }
      .gridlines th {
        border: 1px dotted black;
      }
      .b {
        text-align: center;
      }
      .e {
        text-align: center;
      }
      .f {
        text-align: right;
      }
      .inlineStr {
        text-align: left;
      }
      .n {
        text-align: right;
      }
      .s {
        text-align: left;
      }
      td.style0 {
        vertical-align: bottom;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: none #000000;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 11pt;
        background-color: white;
      }
      th.style0 {
        vertical-align: bottom;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: none #000000;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 11pt;
        background-color: white;
      }
      td.style1 {
        vertical-align: bottom;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style1 {
        vertical-align: bottom;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style2 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #bfbfbf !important;
        border-top: none #000000;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style2 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #bfbfbf !important;
        border-top: none #000000;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style3 {
        vertical-align: bottom;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style3 {
        vertical-align: bottom;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style4 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #bfbfbf !important;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style4 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #bfbfbf !important;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style5 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #bfbfbf !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style5 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #bfbfbf !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style6 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style6 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style7 {
        vertical-align: middle;
        text-align: left;
        padding-left: 9px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style7 {
        vertical-align: middle;
        text-align: left;
        padding-left: 9px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style8 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style8 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style9 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style9 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style10 {
        vertical-align: bottom;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style10 {
        vertical-align: bottom;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style11 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #bfbfbf !important;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style11 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #bfbfbf !important;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style12 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #bfbfbf !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style12 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #bfbfbf !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style13 {
        vertical-align: middle;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style13 {
        vertical-align: middle;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style14 {
        vertical-align: middle;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style14 {
        vertical-align: middle;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style15 {
        vertical-align: middle;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style15 {
        vertical-align: middle;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style16 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style16 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style17 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style17 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style18 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 12pt;
        background-color: white;
      }
      th.style18 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 12pt;
        background-color: white;
      }
      td.style19 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style19 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style20 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 12pt;
        background-color: white;
      }
      th.style20 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 12pt;
        background-color: white;
      }
      td.style21 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style21 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style22 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style22 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style23 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style23 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style24 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style24 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style25 {
        vertical-align: middle;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: none #000000;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style25 {
        vertical-align: middle;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: none #000000;
        border-right: none #000000;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style26 {
        vertical-align: middle;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style26 {
        vertical-align: middle;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style27 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style27 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style28 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style28 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style29 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style29 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style30 {
        vertical-align: middle;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style30 {
        vertical-align: middle;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style31 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style31 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style32 {
        vertical-align: middle;
        border-bottom: 1px solid #000000 !important;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 11pt;
        background-color: white;
      }
      th.style32 {
        vertical-align: middle;
        border-bottom: 1px solid #000000 !important;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 11pt;
        background-color: white;
      }
      td.style33 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: #ffff00;
      }
      th.style33 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: #ffff00;
      }
      td.style34 {
        vertical-align: middle;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style34 {
        vertical-align: middle;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style35 {
        vertical-align: middle;
        text-align: right;
        padding-right: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #ffffff;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: #7f7f7f;
      }
      th.style35 {
        vertical-align: middle;
        text-align: right;
        padding-right: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #ffffff;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: #7f7f7f;
      }
      td.style36 {
        vertical-align: middle;
        text-align: right;
        padding-right: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #ffffff;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: #7f7f7f;
      }
      th.style36 {
        vertical-align: middle;
        text-align: right;
        padding-right: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #ffffff;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: #7f7f7f;
      }
      td.style37 {
        vertical-align: middle;
        text-align: right;
        padding-right: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #ffffff;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: #7f7f7f;
      }
      th.style37 {
        vertical-align: middle;
        text-align: right;
        padding-right: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #ffffff;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: #7f7f7f;
      }
      td.style38 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style38 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style39 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style39 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style40 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style40 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style41 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style41 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style42 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style42 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style43 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style43 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style44 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style44 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style45 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style45 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style46 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style46 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style47 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style47 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style48 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style48 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a3041;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style49 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style49 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style50 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style50 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style51 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #d8d8d8;
        font-family: 'Century Gothic';
        font-size: 28pt;
        background-color: white;
      }
      th.style51 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #d8d8d8;
        font-family: 'Century Gothic';
        font-size: 28pt;
        background-color: white;
      }
      td.style52 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #d8d8d8;
        font-family: 'Century Gothic';
        font-size: 28pt;
        background-color: white;
      }
      th.style52 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #d8d8d8;
        font-family: 'Century Gothic';
        font-size: 28pt;
        background-color: white;
      }
      td.style53 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #d8d8d8;
        font-family: 'Century Gothic';
        font-size: 28pt;
        background-color: white;
      }
      th.style53 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #d8d8d8;
        font-family: 'Century Gothic';
        font-size: 28pt;
        background-color: white;
      }
      td.style54 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #000000;
        font-family: 'Cambria';
        font-size: 18pt;
        background-color: white;
      }
      th.style54 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #000000;
        font-family: 'Cambria';
        font-size: 18pt;
        background-color: white;
      }
      td.style55 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #000000;
        font-family: 'Cambria';
        font-size: 18pt;
        background-color: white;
      }
      th.style55 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #000000;
        font-family: 'Cambria';
        font-size: 18pt;
        background-color: white;
      }
      td.style56 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Cambria';
        font-size: 18pt;
        background-color: white;
      }
      th.style56 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Cambria';
        font-size: 18pt;
        background-color: white;
      }
      td.style57 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style57 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style58 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style58 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style59 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style59 {
        vertical-align: middle;
        text-align: left;
        padding-left: 0px;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style60 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style60 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style61 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style61 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 2px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style62 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: 2px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 12pt;
        background-color: white;
      }
      th.style62 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: 2px solid #000000 !important;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 12pt;
        background-color: white;
      }
      td.style63 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 12pt;
        background-color: white;
      }
      th.style63 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: none #000000;
        border-left: 1px solid #000000 !important;
        border-right: 2px solid #000000 !important;
        font-weight: bold;
        color: #000000;
        font-family: 'Aptos Narrow';
        font-size: 12pt;
        background-color: white;
      }
      td.style64 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style64 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style65 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style65 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style66 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style66 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 2px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style67 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style67 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style68 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style68 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: none #000000;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style69 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      th.style69 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: 1px solid #000000 !important;
        border-left: none #000000;
        border-right: 1px solid #000000 !important;
        font-weight: bold;
        color: #0a1e30;
        font-family: 'Times New Roman';
        font-size: 12pt;
        background-color: white;
      }
      td.style70 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 11pt;
        background-color: white;
      }
      th.style70 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: 1px solid #000000 !important;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 11pt;
        background-color: white;
      }
      td.style71 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 11pt;
        background-color: white;
      }
      th.style71 {
        vertical-align: middle;
        text-align: center;
        border-bottom: none #000000;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 11pt;
        background-color: white;
      }
      td.style72 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 11pt;
        background-color: white;
      }

      th.style72 {
        vertical-align: middle;
        text-align: center;
        border-bottom: 1px solid #000000 !important;
        border-top: none #000000;
        border-left: 2px solid #000000 !important;
        border-right: 1px solid #000000 !important;
        color: #000000;
        font-family: 'Times New Roman';
        font-size: 11pt;
        background-color: white;
      }
      table.sheet0 col.col0 {
        width: 8.13333324pt;
      }
      table.sheet0 col.col1 {
        width: 170.12222027pt;
      }
      table.sheet0 col.col2 {
        width: 126.74444299pt;
      }
      table.sheet0 col.col3 {
        width: 93.53333226pt;
      }
      table.sheet0 col.col4 {
        width: 80.65555463pt;
      }
      table.sheet0 col.col5 {
        width: 94.21111003pt;
      }
      table.sheet0 tr {
        height: 15pt;
      }
      table.sheet0 tr.row0 {
        height: 15.75pt;
      }
      table.sheet0 tr.row1 {
        height: 123pt;
      }
      table.sheet0 tr.row2 {
        height: 25.5pt;
      }
      table.sheet0 tr.row3 {
        height: 26.25pt;
      }
      table.sheet0 tr.row4 {
        height: 26.25pt;
      }
      table.sheet0 tr.row5 {
        height: 26.25pt;
      }
      table.sheet0 tr.row6 {
        height: 26.25pt;
      }
      table.sheet0 tr.row7 {
        height: 26.25pt;
      }
      table.sheet0 tr.row8 {
        height: 26.25pt;
      }
      table.sheet0 tr.row9 {
        height: 27pt;
      }
      table.sheet0 tr.row10 {
        height: 28.5pt;
      }
      table.sheet0 tr.row11 {
        height: 21pt;
      }
      table.sheet0 tr.row12 {
        height: 21pt;
      }
      table.sheet0 tr.row13 {
        height: 21pt;
      }
      table.sheet0 tr.row14 {
        height: 21pt;
      }
      table.sheet0 tr.row15 {
        height: 21pt;
      }
      table.sheet0 tr.row16 {
        height: 22.5pt;
      }
      table.sheet0 tr.row17 {
        height: 12.75pt;
      }
      table.sheet0 tr.row18 {
        height: 33.75pt;
      }
      table.sheet0 tr.row19 {
        height: 26.25pt;
      }
      table.sheet0 tr.row20 {
        height: 26.25pt;
      }
      table.sheet0 tr.row21 {
        height: 26.25pt;
      }
      table.sheet0 tr.row22 {
        height: 33.75pt;
      }
      table.sheet0 tr.row23 {
        height: 26.25pt;
      }
      table.sheet0 tr.row24 {
        height: 33.75pt;
      }
      table.sheet0 tr.row25 {
        height: 33.75pt;
      }
      table.sheet0 tr.row26 {
        height: 33.75pt;
      }
      table.sheet0 tr.row27 {
        height: 33.75pt;
      }
      table.sheet0 tr.row28 {
        height: 28.5pt;
      }
      table.sheet0 tr.row29 {
        height: 42.75pt;
      }
    </style>
  </head>
      <body>
  <table border="0" cellpadding="0" cellspacing="0" id="sheet0" class="sheet0 gridlines" 
       style="width: 50%; margin: 0 auto; border: 2px solid #000000 !important;">
    <col class="col0" />
    <col class="col1" />
    <col class="col2" />
    <col class="col3" />
    <col class="col4" />
    <col class="col5" />
    <tbody>
      <tr class="row1">
        <td class="column1 style51 null style53" colspan="5">
          <div style="position: relative">
            <img
              style="z-index: 1; left: 1px; top: 6px; width: 929px; height: 155px;"
              src="https://agats.s3.ap-south-1.amazonaws.com/logo/logo.jpeg"
              border="0"
            />
          </div>
        </td>
      </tr>
      <tr class="row2">
        <td class="column1 style54 s style56" colspan="5">ESTIMATION</td>
      </tr>
      <tr class="row3">
        <td class="column1 style49 s style50" colspan="2" style="padding-left: 10px;">${
          estimation.project.client.clientName
        }</td>
        <td class="column3 style10 s">DATE</td>
        <td class="column4 style10 null">ESTIMATION</td>
        <td class="column5 style10 null">PAYMENT</td>
      </tr>
      <tr class="row4">
        <td class="column1 style41 s style42" colspan="2" style="padding-left: 10px;">${
          estimation.project.client.clientAddress
        }</td>
        <td class="column3 style11 s">OF ESTIMATION</td>
        <td class="column4 style11 null">NUMBER</td>
        <td class="column5 style11 null">DUE BY</td>
      </tr>
      <tr class="row5">
        <td class="column1 style41 s style42" colspan="2" style="padding-left: 10px;">
          ${estimation.project.location} ,  ${estimation.project.building} ,  ${
      estimation.project.apartmentNumber
    } 
        </td>
        <td class="column3 style12 s">${formatDate(new Date())}</td>
        <td class="column4 style12 null">${estimation.estimationNumber}</td>
        <td class="column5 style12 null">${estimation.paymentDueBy} Days</td>
      </tr>
    
      <tr class="row5">      
              <td class="column1 style41 s style42" colspan="5" style="padding-left: 10px;">
              <br/>
Email: ${estimation.project.client.email} <br/> <br/>
Mobile:  ${ estimation.project.client.mobileNumber} <br/> <br/>
Tel: ${estimation.project.client.telephoneNumber}
<br/>
</td>

        
   
      </tr>
  
      <tr class="row9">
        <td class="column1 style13 null">${estimation.subject}</td>
        <td class="column2 style25 null"></td>
        <td class="column3 style25 null"></td>
        <td class="column4 style25 null"></td>
        <td class="column5 style14 null"></td>
      </tr>

      <!-- Materials section -->
      <tr class="row10">
        <td class="column2 style6 s">MATERIAL</td>
        <td class="column5 style16 s">UOM</td>
        <td class="column3 style6 s">QTY</td>
        <td class="column4 style22 s">UNIT PRICE</td>
        <td class="column5 style16 s">TOTAL</td>
      </tr>
      ${estimation.materials
        .map(
          (material) => `
        <tr class="row11">
          <td class="column2 style7 s">${material.description}</td>
          <td class="column5 style16 f">${material.uom}</td>
          <td class="column3 style8 n">${material.quantity.toFixed(2)}</td>
          <td class="column4 style21 n">${material.unitPrice.toFixed(2)}</td>
          <td class="column5 style16 f">${material.total.toFixed(2)}</td>
        </tr>
      `
        )
        .join("")}
      <tr class="row16">
        <td class="column2 style35 s style37" colspan="4">TOTAL MATERIALS&nbsp;&nbsp;</td>
        <td class="column5 style18 f">${materialsTotal.toFixed(2)}</td>
      </tr>
      <tr class="row17">
        <td class="column1 style43 null style45" colspan="5"></td>
      </tr>

      <!-- Labour section -->
      <tr class="row18">
        <td class="column1 style15 s">LABOUR CHARGES</td>
        <td class="column2 style9 s">DESIGNATION</td>
        <td class="column3 style22 s">QTY/DAYS</td>
        <td class="column4 style6 s">PRICE</td>
        <td class="column5 style16 s">TOTAL</td>
      </tr>
      ${estimation.labour
        .map(
          (labour, index) => `
          <tr class="row19">
            ${
              index === 0
                ? `<td class="column1 style46 null style48" rowspan="${
                    estimation.labour.length + 1
                  }"></td>`
                : ""
            }
            <td class="column2 style7 s">${labour.designation}</td>
            <td class="column3 style21 n">${labour.days.toFixed(2)}</td>
            <td class="column4 style21 n">${labour.price.toFixed(2)}</td>
            <td class="column5 style17 f">${labour.total.toFixed(2)}</td>
          </tr>
        `
        )
        .join("")}
      <tr class="row21">
        <td class="column2 style35 s style37" colspan="3">TOTAL LABOUR &nbsp;&nbsp;</td>
        <td class="column5 style18 f">${labourTotal.toFixed(2)}</td>
      </tr>

      <!-- Terms and conditions section -->
      <tr class="row18">
        <td class="column1 style15 s">TERMS AND CONDITIONS</td>
        <td class="column2 style9 s">MISCELLANEOUS CHARGES</td>
        <td class="column3 style22 s">QTY</td>
        <td class="column4 style6 s">PRICE</td>
        <td class="column5 style16 s">TOTAL</td>
      </tr>
      ${estimation.termsAndConditions
        .map(
          (term, index) => `
          <tr class="row19">
            ${
              index === 0
                ? `<td class="column1 style34 null" rowspan="${
                    estimation.termsAndConditions.length + 1
                  }"></td>`
                : ""
            }
            <td class="column2 style7 s">${term.description}</td>
            <td class="column3 style21 n">${term.quantity.toFixed(2)}</td>
            <td class="column4 style8 n">${term.unitPrice.toFixed(2)}</td>
            <td class="column5 style17 f">${term.total.toFixed(2)}</td>
          </tr>
        `
        )
        .join("")}
      <tr class="row24">
        <td class="column2 style35 s style37" colspan="3">
          TOTAL MISCELLANEOUS &nbsp;&nbsp;
        </td>
        <td class="column5 style18 f">${termsTotal.toFixed(2)}</td>
      </tr>

      <!-- Amount summary -->
      <tr class="row25">
        <td class="column1 style38 s style40" colspan="4" style="padding-left: 10px;">
          ESTIMATED AMOUNT
        </td>
        <td class="column5 style17 f">${estimatedAmount.toFixed(2)}</td>
      </tr>
      <tr class="row26">
        <td class="column1 style38 s style40" colspan="4" style="padding-left: 10px;">
          QUOTATION AMOUNT
        </td>
        <td class="column5 style33 n">${
          quotation?.netAmount?.toFixed(2) || "0.00"
        }</td>
      </tr>
        <tr class="row26">
        <td class="column1 style38 s style40" colspan="4" style="padding-left: 10px;">
          COMMISSION AMOUNT
        </td>
        <td class="column5 style33 n">${
          estimation.commissionAmount?.toFixed(2) || "0.00"
        }</td>
      </tr>
      <tr class="row27">
        <td class="column1 style57 s style59" colspan="4" style="padding-left: 10px;">PROFIT</td>
        <td class="column5 style20 f">
          ${profit || "0.00"}
        </td>
      </tr>

      <!-- Approval section -->
      <tr class="row28">
        <td class="column1 style28 s">Prepared By: ${
          preparedBy?.firstName || "N/A"
        }</td>
        <td class="column2 style29 s">Checked By: ${
          checkedBy?.firstName || "N/A"
        }</td>
        <td class="column3 style60 s style61" colspan="2">
          Approved by: ${approvedBy?.firstName || "N/A"}
        </td>
        <td class="column5 style62 null style63" rowspan="2"></td>
      </tr>
      
    </tbody>
  </table>
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
          top: "0.5in",
          right: "0.5in",
          bottom: "0.5in",
          left: "0.5in",
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
