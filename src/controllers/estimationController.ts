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
      quotationAmount,
      subject,
      workDays, // Added
      dailyStartTime, // Added
      dailyEndTime, // Added
    } = req.body;

    // Validate required fields - removed workStartDate and workEndDate from required
    if (
      !project ||
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

    // Calculate workDays if dates are provided
    let calculatedWorkDays = workDays || 0;
    if (workStartDate && workEndDate) {
      const start = new Date(workStartDate);
      const end = new Date(workEndDate);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      calculatedWorkDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 0;
    }

    const estimation = await Estimation.create({
      project,
      estimationNumber: await generateRelatedDocumentNumber(project, "ESTAGA"),
      workStartDate: workStartDate ? new Date(workStartDate) : undefined,
      workEndDate: workEndDate ? new Date(workEndDate) : undefined,
      workDays: calculatedWorkDays,
      dailyStartTime: dailyStartTime || "09:00",
      dailyEndTime: dailyEndTime || "18:00",
      validUntil: new Date(validUntil),
      paymentDueBy,
      materials: materials || [],
      labour: labour || [],
      termsAndConditions: termsAndConditions || [],
      commissionAmount,
      quotationAmount,
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
        contactEmail: "info@alghazalgroup.com",
        logoUrl:
          "https://agats.s3.ap-south-1.amazonaws.com/logo/alghlogo.jpg",
        estimationNumber: estimation.estimationNumber,
        checkerName: approver
          ? `${approver.firstName} ${approver.lastName}`
          : "an approver",
        projectName: estimation.project.projectName || "the project",
        dueDate: estimation.validUntil?.toLocaleDateString(),
      };

      // Send email to all recipients
      await mailer.sendEmail({
        to: process.env.NOTIFICATION_INBOX || "info@alghazalgroup.com",
        bcc: uniqueRecipients.map((r) => r.email).join(","),
        subject: `Estimation ${isApproved ? "Approved" : "Rejected"}: ${estimation.estimationNumber
          }`,
        templateParams: templateParams, // Just pass the templateParams without content
        text: `Dear Team,\n\nEstimation ${estimation.estimationNumber
          } for project ${templateParams.projectName} has been ${isApproved ? "approved" : "rejected"
          } by ${templateParams.checkerName}.\n\nView project: ${templateParams.actionUrl
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
          contactEmail: "info@alghazalgroup.com",
          logoUrl:
            "https://agats.s3.ap-south-1.amazonaws.com/logo/alghlogo.jpg",
          estimationNumber: estimation.estimationNumber,
          checkerName: checkedByUser
            ? `${checkedByUser.firstName} ${checkedByUser.lastName}`
            : "a team member",
          projectName: project?.projectName || "the project",
          dueDate: estimation.validUntil?.toLocaleDateString(),
        };

        // Send single email to all admins (BCC to hide recipient list)
        await mailer.sendEmail({
          to: process.env.NOTIFICATION_INBOX || "info@alghazalgroup.com",
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

    // Calculate workDays if dates are provided in update
    if (updateData.workStartDate || updateData.workEndDate) {
      const start = updateData.workStartDate ? new Date(updateData.workStartDate) : estimation.workStartDate;
      const end = updateData.workEndDate ? new Date(updateData.workEndDate) : estimation.workEndDate;

      if (start && end) {
        const diffTime = Math.abs(end.getTime() - start.getTime());
        updateData.workDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 0;
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


//   async (req: Request, res: Response) => {
//     const { id } = req.params;

//     const estimation = await Estimation.findById(id)
//       .populate<PopulatedEstimation>({
//         path: "project",
//         select: "projectName client location building apartmentNumber",
//         populate: {
//           path: "client",
//           select: "clientName clientAddress email mobileNumber telephoneNumber",
//         },
//       })
//       .populate("preparedBy", "firstName signatureImage")
//       .populate("checkedBy", "firstName signatureImage")
//       .populate("approvedBy", "firstName signatureImage");

//     if (!estimation) {
//       throw new ApiError(404, "Estimation not found");
//     }

//     // Safe data access functions
//     const safeGet = (value: any, defaultValue = "N/A") => {
//       return value !== null && value !== undefined && value !== "" ? value : defaultValue;
//     };

//     const safeGetNumber = (value: any, defaultValue = 0) => {
//       return value !== null && value !== undefined ? Number(value) : defaultValue;
//     };

//     const safeGetDate = (date?: Date) => {
//       return date ? new Date(date).toLocaleDateString("en-GB") : "N/A";
//     };

//     // Type guard to check if populated fields are IUser objects
//     const isPopulatedUser = (
//       user: any
//     ): user is Pick<IUser, "firstName" | "signatureImage"> => {
//       return user && typeof user === "object" && "firstName" in user;
//     };

//     // Get user data with proper typing
//     const preparedBy = isPopulatedUser(estimation.preparedBy)
//       ? estimation.preparedBy
//       : null;
//     const checkedBy = isPopulatedUser(estimation.checkedBy)
//       ? estimation.checkedBy
//       : null;
//     const approvedBy = isPopulatedUser(estimation.approvedBy)
//       ? estimation.approvedBy
//       : null;

//     // Calculate totals with safe defaults
//     const materialsTotal = estimation.materials?.reduce(
//       (sum, item) => sum + safeGetNumber(item.total),
//       0
//     ) || 0;

//     const labourTotal = estimation.labour?.reduce(
//       (sum, item) => sum + safeGetNumber(item.total),
//       0
//     ) || 0;

//     const termsTotal = estimation.termsAndConditions?.reduce(
//       (sum, item) => sum + safeGetNumber(item.total),
//       0
//     ) || 0;

//     const estimatedAmount = materialsTotal + labourTotal + termsTotal;
//     const netAmount = safeGetNumber(estimation?.quotationAmount);
//     const commissionAmount = safeGetNumber(estimation?.commissionAmount);

//     // Get the actual profit value (can be negative)
//     const actualProfit = estimation.profit || 0;

//     // Calculate profit/loss percentage based on actual profit
//     const calculateProfitPercentage = () => {
//       if (estimatedAmount === 0) return 0;
//       const percentage = (actualProfit / netAmount) * 100;
//       return parseFloat(percentage.toFixed(2));
//     };

//     const profitPercentage = calculateProfitPercentage();
//     const isProfit = actualProfit > 0;
//     const isLoss = actualProfit < 0;

//     // Safe access to nested properties
//     const clientName = estimation.project?.client?.clientName || "N/A";
//     const clientAddress = estimation.project?.client?.clientAddress || "N/A";
//     const projectLocation = estimation.project?.location || "N/A";
//     const projectBuilding = estimation.project?.building || "N/A";
//     const apartmentNumber = estimation.project?.apartmentNumber || "N/A";
//     const clientEmail = estimation.project?.client?.email || "N/A";
//     const clientMobile = estimation.project?.client?.mobileNumber || "";
//     const clientTelephone = estimation.project?.client?.telephoneNumber || "";

//     const clientPhone = clientMobile || clientTelephone
//       ? `${clientMobile}${clientMobile && clientTelephone ? ' / ' : ''}${clientTelephone}`
//       : "N/A";

//     // Prepare HTML content - keeping the original UI structure
//     let htmlContent = `
//     <!DOCTYPE html>
//     <html>
//     <head>
//       <meta charset="utf-8">
//       <style>
//         @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

//         * {
//           margin: 0;
//           padding: 0;
//           box-sizing: border-box;
//         }

//         body {
//           font-family: 'Inter', sans-serif;
//           color: #333;
//           background-color: #fff;
//           line-height: 1.6;
//           padding: 15px;
//           font-size: 11pt;
//         }

//         .container {
//           max-width: 1000px;
//           margin: 0 auto;
//           border: 1px solid #e0e0e0;
//           border-radius: 8px;
//           overflow: hidden;
//           box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
//         }

//         .header {
//           background: linear-gradient(135deg, #0a3041 0%, #1a4d70 100%);
//           color: white;
//           padding: 25px 30px;
//           display: flex;
//           justify-content: space-between;
//           align-items: flex-start;
//         }

//         .logo-container {
//           flex: 1;
//         }

//         .logo {
//           max-width: 200px;
//           height: auto;
//         }

//         .document-info {
//           text-align: right;
//         }

//         .document-title {
//           font-size: 32px;
//           font-weight: 700;
//           margin-bottom: 8px;
//           letter-spacing: 0.5px;
//         }

//         .document-number {
//           font-size: 18px;
//           font-weight: 500;
//           opacity: 0.9;
//         }

//         .content {
//           padding: 30px;
//         }

//         .section {
//           margin-bottom: 35px;
//         }

//         .section-title {
//           font-size: 20px;
//           font-weight: 600;
//           color: #0a3041;
//           padding-bottom: 12px;
//           border-bottom: 2px solid #94d7f4;
//           margin-bottom: 20px;
//         }

//         .client-info {
//           display: grid;
//           grid-template-columns: 1fr 1fr;
//           gap: 30px;
//           margin-bottom: 35px;
//         }

//         .info-card {
//           background-color: #f9fafb;
//           border-radius: 6px;
//           padding: 20px;
//           border-left: 4px solid #94d7f4;
//         }

//         .info-card h3 {
//           font-size: 17px;
//           font-weight: 600;
//           color: #0a3041;
//           margin-bottom: 15px;
//         }

//         .info-item {
//           margin-bottom: 10px;
//           display: flex;
//           font-size: 11pt;
//         }

//         .info-label {
//           font-weight: 500;
//           min-width: 120px;
//           color: #555;
//         }

//         .info-value {
//           font-weight: 400;
//           color: #333;
//         }

//         table {
//           width: 100%;
//           border-collapse: collapse;
//           margin-bottom: 25px;
//           font-size: 10.5pt;
//         }

//         th {
//           background-color: #94d7f4;
//           text-align: left;
//           padding: 14px 15px;
//           font-weight: 600;
//           color: #000;
//           border-bottom: 2px solid #e5e7eb;
//           font-size: 11pt;
//         }

//         td {
//           padding: 12px 15px;
//           border-bottom: 1px solid #e5e7eb;
//           font-size: 10.5pt;
//         }

//         tr:last-child td {
//           border-bottom: none;
//         }

//         .text-right {
//           text-align: right;
//         }

//         .text-center {
//           text-align: center;
//         }

//         .summary-table {
//           width: 60%;
//           margin-left: auto;
//           font-size: 11pt;
//         }

//         .summary-table td {
//           padding: 12px 15px;
//         }

//         .summary-table tr:last-child td {
//           border-bottom: 1px solid #e5e7eb;
//         }

//         .total-row {
//           font-weight: 600;
//           background-color: #f8f9fa;
//           font-size: 11pt;
//         }

//         .profit-row {
//           font-weight: 700;
//           background-color: ${actualProfit >= 0 ? '#e8f5e9' : '#ffebee'};
//           color: ${actualProfit >= 0 ? '#2e7d32' : '#c62828'};
//           font-size: 12pt;
//         }

//         .profit-percentage-row {
//           font-weight: 700;
//           background-color: ${isProfit ? '#e8f5e9' : '#ffebee'};
//           color: ${isProfit ? '#2e7d32' : '#c62828'};
//           font-size: 12pt;
//         }

//         .profit-percentage-badge {
//           display: inline-block;
//           padding: 2px 8px;
//           border-radius: 12px;
//           font-size: 10px;
//           font-weight: 600;
//           margin-left: 8px;
//           background: ${isProfit ? '#4caf50' : '#f44336'};
//           color: white;
//         }

//         .signatures {
//           display: grid;
//           grid-template-columns: repeat(3, 1fr);
//           gap: 25px;
//           margin-top: 40px;
//           padding-top: 30px;
//           border-top: 2px dashed #ccc;
//         }

//         .signature-box {
//           text-align: center;
//         }

//         .signature-line {
//           height: 1px;
//           background-color: #666;
//           margin: 40px 0 12px;
//         }

//         .signature-name {
//           font-weight: 600;
//           color: #0a3041;
//           font-size: 12pt;
//           margin-top: 5px;
//         }

//         .signature-role {
//           font-size: 11pt;
//           color: #555;
//           font-weight: 500;
//         }

//         .signature-date {
//           font-size: 10px;
//           color: #666;
//           margin-top: 5px;
//           font-weight: 400;
//         }

//         .footer {
//           margin-top: 40px;
//           text-align: center;
//           font-size: 11pt;
//           color: #555;
//           padding: 20px;
//           border-top: 2px solid #e5e7eb;
//           background-color: #f8f9fa;
//         }

//         .company-info {
//           margin-top: 10px;
//           font-size: 11pt;
//           font-weight: 600;
//           color: #0a3041;
//         }

//         .notes {
//           background-color: #f9fafb;
//           padding: 18px;
//           border-radius: 6px;
//           margin-top: 30px;
//           font-size: 10.5pt;
//           border-left: 4px solid #94d7f4;
//         }

//         .notes-title {
//           font-weight: 600;
//           margin-bottom: 10px;
//           color: #0a3041;
//           font-size: 11pt;
//         }

//         @media (max-width: 768px) {
//           .client-info {
//             grid-template-columns: 1fr;
//             gap: 20px;
//           }

//           .signatures {
//             grid-template-columns: 1fr;
//             gap: 20px;
//           }

//           .summary-table {
//             width: 100%;
//           }
//         }

//         tbody tr:hover {
//           background-color: #f5f5f5;
//         }

//         .empty-state {
//           text-align: center;
//           color: #666;
//           font-style: italic;
//           padding: 20px;
//           background-color: #f9f9f9;
//           border-radius: 4px;
//         }

//         .amount {
//           font-family: 'Courier New', monospace;
//           font-weight: 500;
//         }
//       </style>
//     </head>
//     <body>
//       <div class="container">
//         <div class="header">
//           <div class="logo-container">
//             <img class="logo" src="https://agats.s3.ap-south-1.amazonaws.com/logo/logo.jpeg" alt="Company Logo">
//           </div>
//           <div class="document-info">
//             <div class="document-title">ESTIMATION</div>
//             <div class="document-number">Ref: ${safeGet(estimation.estimationNumber)}</div>
//           </div>
//         </div>

//         <div class="content">
//           <div class="client-info">
//             <div class="info-card">
//               <h3>CLIENT INFORMATION</h3>
//               <div class="info-item">
//                 <span class="info-label">Name:</span>
//                 <span class="info-value">${clientName}</span>
//               </div>
//               <div class="info-item">
//                 <span class="info-label">Address:</span>
//                 <span class="info-value">${clientAddress}</span>
//               </div>
//               <div class="info-item">
//                 <span class="info-label">Project:</span>
//                 <span class="info-value">${projectLocation}, ${projectBuilding}, ${apartmentNumber}</span>
//               </div>
//               <div class="info-item">
//                 <span class="info-label">Email:</span>
//                 <span class="info-value">${clientEmail}</span>
//               </div>
//               <div class="info-item">
//                 <span class="info-label">Phone:</span>
//                 <span class="info-value">${clientPhone}</span>
//               </div>
//             </div>

//             <div class="info-card">
//               <h3>ESTIMATION DETAILS</h3>
//               <div class="info-item">
//                 <span class="info-label">Date:</span>
//                 <span class="info-value">${safeGetDate(new Date())}</span>
//               </div>
//               <div class="info-item">
//                 <span class="info-label">Estimation #:</span>
//                 <span class="info-value">${safeGet(estimation.estimationNumber)}</span>
//               </div>
//               <div class="info-item">
//                 <span class="info-label">Payment Terms:</span>
//                 <span class="info-value">${safeGet(estimation.paymentDueBy, "N/A")} ${estimation.paymentDueBy ? "Days" : ""}</span>
//               </div>
//               <div class="info-item">
//                 <span class="info-label">Subject:</span>
//                 <span class="info-value">${safeGet(estimation.subject)}</span>
//               </div>
//             </div>
//           </div>

//           <div class="section">
//             <h2 class="section-title">MATERIALS</h2>
//             <table>
//               <thead>
//                 <tr>
//                   <th>Description</th>
//                   <th>UOM</th>
//                   <th class="text-right">Quantity</th>
//                   <th class="text-right">Unit Price</th>
//                   <th class="text-right">Total</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 ${(estimation.materials || []).length > 0
//         ? estimation.materials.map(
//           (material) => `
//                   <tr>
//                     <td>${safeGet(material.description)}</td>
//                     <td>${safeGet(material.uom)}</td>
//                     <td class="text-right amount">${safeGetNumber(material.quantity).toFixed(2)}</td>
//                     <td class="text-right amount">${safeGetNumber(material.unitPrice).toFixed(2)}</td>
//                     <td class="text-right amount">${safeGetNumber(material.total).toFixed(2)}</td>
//                   </tr>
//                 `).join("")
//         : `<tr><td colspan="5" class="empty-state">No materials listed</td></tr>`
//       }
//                 <tr class="total-row">
//                   <td colspan="4" class="text-right"><strong>TOTAL MATERIALS</strong></td>
//                   <td class="text-right amount"><strong>${materialsTotal.toFixed(2)}</strong></td>
//                 </tr>
//               </tbody>
//             </table>
//           </div>

//           <div class="section">
//             <h2 class="section-title">LABOR CHARGES</h2>
//             <table>
//               <thead>
//                 <tr>
//                   <th>Designation</th>
//                   <th class="text-right">Qty/Days</th>
//                   <th class="text-right">Price</th>
//                   <th class="text-right">Total</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 ${(estimation.labour || []).length > 0
//         ? estimation.labour.map(
//           (labour) => `
//                   <tr>
//                     <td>${safeGet(labour.designation)}</td>
//                     <td class="text-right amount">${safeGetNumber(labour.days).toFixed(2)}</td>
//                     <td class="text-right amount">${safeGetNumber(labour.price).toFixed(2)}</td>
//                     <td class="text-right amount">${safeGetNumber(labour.total).toFixed(2)}</td>
//                   </tr>
//                 `).join("")
//         : `<tr><td colspan="4" class="empty-state">No labor charges listed</td></tr>`
//       }
//                 <tr class="total-row">
//                   <td colspan="3" class="text-right"><strong>TOTAL LABOR</strong></td>
//                   <td class="text-right amount"><strong>${labourTotal.toFixed(2)}</strong></td>
//                 </tr>
//               </tbody>
//             </table>
//           </div>

//           <div class="section">
//             <h2 class="section-title">MISCELLANEOUS CHARGES</h2>
//             <table>
//               <thead>
//                 <tr>
//                   <th>Description</th>
//                   <th class="text-right">Quantity</th>
//                   <th class="text-right">Unit Price</th>
//                   <th class="text-right">Total</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 ${(estimation.termsAndConditions || []).length > 0
//         ? estimation.termsAndConditions.map(
//           (term) => `
//                   <tr>
//                     <td>${safeGet(term.description)}</td>
//                     <td class="text-right amount">${safeGetNumber(term.quantity).toFixed(2)}</td>
//                     <td class="text-right amount">${safeGetNumber(term.unitPrice).toFixed(2)}</td>
//                     <td class="text-right amount">${safeGetNumber(term.total).toFixed(2)}</td>
//                   </tr>
//                 `).join("")
//         : `<tr><td colspan="4" class="empty-state">No miscellaneous charges listed</td></tr>`
//       }
//                 <tr class="total-row">
//                   <td colspan="3" class="text-right"><strong>TOTAL MISCELLANEOUS</strong></td>
//                   <td class="text-right amount"><strong>${termsTotal.toFixed(2)}</strong></td>
//                 </tr>
//               </tbody>
//             </table>
//           </div>

//           <div class="section">
//             <h2 class="section-title">FINANCIAL SUMMARY</h2>
//             <table class="summary-table">
//               <tr class="total-row">
//                 <td><strong>Estimated Amount</strong></td>
//                 <td class="text-right amount"><strong>${estimatedAmount.toFixed(2)}</strong></td>
//               </tr>
//               <tr>
//                 <td>Quotation Amount</td>
//                 <td class="text-right amount">${netAmount.toFixed(2)}</td>
//               </tr>
//               <tr>
//                 <td>Commission Amount</td>
//                 <td class="text-right amount">${commissionAmount.toFixed(2)}</td>
//               </tr>
//               <tr class="profit-row">
//                 <td><strong>${actualProfit >= 0 ? 'PROFIT' : 'LOSS'}</strong></td>
//                 <td class="text-right amount"><strong>${actualProfit.toFixed(2)}</strong></td>
//               </tr>
//               <tr class="profit-percentage-row">
//                 <td><strong>${isProfit ? 'PROFIT' : 'LOSS'} PERCENTAGE</strong></td>
//                 <td class="text-right amount">
//                   <strong>${profitPercentage}%</strong>
//                   <span class="profit-percentage-badge">${isProfit ? 'PROFIT' : 'LOSS'}</span>
//                 </td>
//               </tr>
//             </table>
//           </div>

//           <div class="signatures">
//             <div class="signature-box">
//               <div class="signature-role">Prepared By</div>
//               <div class="signature-line"></div>
//               <div class="signature-name">${preparedBy?.firstName || "N/A"}</div>
//               <div class="signature-date">${safeGetDate(new Date())}</div>
//             </div>
//             <div class="signature-box">
//               <div class="signature-role">Checked By</div>
//               <div class="signature-line"></div>
//               <div class="signature-name">${checkedBy?.firstName || "N/A"}</div>
//               <div class="signature-date">${safeGetDate(new Date())}</div>
//             </div>
//             <div class="signature-box">
//               <div class="signature-role">Approved By</div>
//               <div class="signature-line"></div>
//               <div class="signature-name">${approvedBy?.firstName || "N/A"}</div>
//               <div class="signature-date">${safeGetDate(new Date())}</div>
//             </div>
//           </div>

//           <div class="notes">
//             <div class="notes-title">Notes:</div>
//             <div>This estimation is valid for 30 days from the date of issue. Prices are subject to change without prior notice.</div>
//           </div>
//         </div>

//         <div class="footer">
//           Thank you for your business!
//           <div class="company-info">
//             Alghazal Alabyad Technical Services
//           </div>
//         </div>
//       </div>
//     </body>
//     </html>
//   `;

//     // Generate PDF
//     const browser = await puppeteer.launch({
//       headless: "shell",
//       args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
//     });

//     try {
//       const page = await browser.newPage();

//       await page.setViewport({
//         width: 1200,
//         height: 1800,
//         deviceScaleFactor: 1,
//       });

//       await page.setContent(htmlContent, {
//         waitUntil: ["load", "networkidle0", "domcontentloaded"],
//         timeout: 30000,
//       });

//       // Additional wait for dynamic content
//       await page.waitForSelector("body", { timeout: 5000 });

//       const pdfBuffer = await page.pdf({
//         format: "A4",
//         printBackground: true,
//         // margin: {
//         //   top: "0.1in",
//         //   right: "0.1in",
//         //   bottom: "0.1in",
//         //   left: "0.1in",
//         // },
//         preferCSSPageSize: true,
//       });

//       res.setHeader("Content-Type", "application/pdf");
//       res.setHeader(
//         "Content-Disposition",
//         `attachment; filename=estimation-${safeGet(estimation.estimationNumber, "unknown")}.pdf`
//       );
//       res.send(pdfBuffer);
//     } finally {
//       await browser.close();
//     }
//   }
// );

// Helper function to format time from HH:mm to 12-hour format
const formatTimeForPDF = (timeString: string): string => {
  if (!timeString) return "N/A";
  try {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const formattedHour = hour % 12 || 12;
    return `${formattedHour}:${minutes} ${ampm}`;
  } catch (error) {
    return timeString;
  }
};

// Helper function to format date
const formatDateForPDF = (date?: Date): string => {
  if (!date) return 'N/A';
  const d = new Date(date);
  return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};
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

    // Safe data access functions
    const safeGet = (value: any, defaultValue = "N/A") => {
      return value !== null && value !== undefined && value !== "" ? value : defaultValue;
    };

    const safeGetNumber = (value: any, defaultValue = 0) => {
      return value !== null && value !== undefined ? Number(value) : defaultValue;
    };

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

    // Calculate totals with safe defaults
    const materialsTotal = estimation.materials?.reduce(
      (sum, item) => sum + safeGetNumber(item.total),
      0
    ) || 0;

    const labourTotal = estimation.labour?.reduce(
      (sum, item) => sum + safeGetNumber(item.total),
      0
    ) || 0;

    const termsTotal = estimation.termsAndConditions?.reduce(
      (sum, item) => sum + safeGetNumber(item.total),
      0
    ) || 0;

    const estimatedAmount = materialsTotal + labourTotal + termsTotal;
    const netAmount = safeGetNumber(estimation?.quotationAmount);
    const commissionAmount = safeGetNumber(estimation?.commissionAmount);

    // Get the actual profit value (can be negative)
    const actualProfit = estimation.profit || 0;

    // Calculate profit/loss percentage based on actual profit
    const calculateProfitPercentage = () => {
      if (netAmount === 0) return 0;
      const percentage = (actualProfit / netAmount) * 100;
      return parseFloat(percentage.toFixed(2));
    };

    const profitPercentage = calculateProfitPercentage();
    const isProfit = actualProfit > 0;
    const isLoss = actualProfit < 0;

    // Safe access to nested properties
    const clientName = estimation.project?.client?.clientName || "N/A";
    const clientAddress = estimation.project?.client?.clientAddress || "N/A";
    const projectLocation = estimation.project?.location || "N/A";
    const projectBuilding = estimation.project?.building || "N/A";
    const apartmentNumber = estimation.project?.apartmentNumber || "N/A";
    const clientEmail = estimation.project?.client?.email || "N/A";
    const clientMobile = estimation.project?.client?.mobileNumber || "";
    const clientTelephone = estimation.project?.client?.telephoneNumber || "";

    const clientPhone = clientMobile || clientTelephone
      ? `${clientMobile}${clientMobile && clientTelephone ? ' / ' : ''}${clientTelephone}`
      : "N/A";

    // Current date for document
    const currentDate = new Date();
    const formattedCurrentDate = currentDate.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    // Helper function to format optional dates
    const formatOptionalDate = (date?: Date): string => {
      if (!date) return 'To be decided';
      const d = new Date(date);
      return isNaN(d.getTime()) ? 'To be decided' : d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    };

    // Prepare HTML content
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Estimation - ${safeGet(estimation.estimationNumber)}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Source+Code+Pro:wght@400;500;600&display=swap');

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', sans-serif;
          color: #1f2937;
          background: #ffffff;
          line-height: 1.4;
          font-size: 9.5pt;
          padding: 15mm;
        }

        /* Header Styles */
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 25px;
          padding-bottom: 20px;
          border-bottom: 2px solid #e5e7eb;
        }

        .company-info {
          flex: 1;
        }

        .company-logo {
          width: 180px;
          margin-bottom: 10px;
        }

        .company-name {
          font-size: 22px;
          font-weight: 700;
          color: #1e40af;
          margin-bottom: 5px;
        }

        .company-tagline {
          font-size: 11px;
          color: #6b7280;
          margin-bottom: 3px;
        }

        .document-title {
          text-align: right;
        }

        .document-title h1 {
          font-size: 32px;
          font-weight: 800;
          color: #111827;
          margin-bottom: 8px;
          background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .document-number {
          font-size: 14px;
          font-weight: 600;
          color: #4b5563;
          background: #f3f4f6;
          padding: 8px 16px;
          border-radius: 6px;
          display: inline-block;
        }

        .document-date {
          font-size: 11px;
          color: #6b7280;
          margin-top: 5px;
        }

        /* Client & Estimation Info */
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 25px;
          margin-bottom: 30px;
        }

        .info-card {
          background: linear-gradient(to bottom, #ffffff, #f9fafb);
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 20px;
          position: relative;
          overflow: hidden;
        }

        .info-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 4px;
          height: 100%;
          background: linear-gradient(to bottom, #3b82f6, #1e40af);
        }

        .card-header {
          display: flex;
          align-items: center;
          margin-bottom: 15px;
        }

        .card-icon {
          width: 28px;
          height: 28px;
          background: linear-gradient(135deg, #3b82f6, #1e40af);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 10px;
          color: white;
          font-weight: 600;
          font-size: 12px;
        }

        .card-title {
          font-size: 14px;
          font-weight: 700;
          color: #111827;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px dashed #e5e7eb;
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-label {
          font-size: 10px;
          color: #6b7280;
          font-weight: 500;
          min-width: 120px;
        }

        .info-value {
          font-size: 10.5px;
          color: #111827;
          font-weight: 500;
          text-align: right;
          flex: 1;
        }

        /* Work Schedule - Conditional Styling */
        .work-schedule {
          background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
          border-radius: 10px;
          padding: 20px;
          margin: 25px 0;
          border: 1px solid #d1d5db;
        }

        .work-schedule h3 {
          font-size: 15px;
          font-weight: 700;
          color: #1e40af;
          margin-bottom: 15px;
          display: flex;
          align-items: center;
        }

        .work-schedule h3::before {
          content: '📅';
          margin-right: 8px;
          font-size: 18px;
        }

        .schedule-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }

        .schedule-item {
          background: white;
          padding: 12px;
          border-radius: 6px;
          border: 1px solid #e5e7eb;
          text-align: center;
        }

        .schedule-label {
          font-size: 10px;
          color: #6b7280;
          margin-bottom: 4px;
          font-weight: 500;
        }

        .schedule-value {
          font-size: 13px;
          font-weight: 700;
          color: #111827;
        }

        .schedule-value.to-be-decided {
          color: #6b7280;
          font-style: italic;
          font-weight: normal;
        }

        /* Tables */
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 30px 0 15px;
          padding-bottom: 10px;
          border-bottom: 2px solid #3b82f6;
        }

        .section-title {
          font-size: 16px;
          font-weight: 700;
          color: #111827;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .section-subtitle {
          font-size: 11px;
          color: #6b7280;
          font-weight: 500;
        }

        .table-container {
          margin-bottom: 25px;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid #e5e7eb;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9.5pt;
        }

        thead {
          background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
        }

        thead th {
          color: white;
          font-weight: 600;
          text-transform: uppercase;
          font-size: 9.5pt;
          letter-spacing: 0.3px;
          padding: 12px 15px;
          text-align: left;
          border-right: 1px solid rgba(255, 255, 255, 0.1);
        }

        thead th:last-child {
          border-right: none;
        }

        tbody tr {
          border-bottom: 1px solid #e5e7eb;
        }

        tbody tr:nth-child(even) {
          background-color: #f9fafb;
        }

        tbody tr:hover {
          background-color: #f3f4f6;
        }

        tbody td {
          padding: 10px 15px;
          font-size: 9.5pt;
          color: #374151;
        }

        .text-right {
          text-align: right;
        }

        .text-center {
          text-align: center;
        }

        .amount {
          font-family: 'Source Code Pro', monospace;
          font-weight: 500;
          color: #111827;
        }

        /* Summary Section */
        .summary-section {
          background: linear-gradient(to bottom, #f8fafc, #f1f5f9);
          border-radius: 10px;
          padding: 25px;
          margin: 30px 0;
          border: 1px solid #e2e8f0;
        }

        .summary-title {
          font-size: 16px;
          font-weight: 700;
          color: #1e40af;
          margin-bottom: 20px;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .summary-table {
          width: 60%;
          margin: 0 auto;
          border-collapse: separate;
          border-spacing: 0;
        }

        .summary-table tr {
          border: none;
        }

        .summary-table td {
          padding: 12px 20px;
          border-bottom: 1px solid #e5e7eb;
          font-size: 10.5pt;
        }

        .summary-table tr:last-child td {
          border-bottom: none;
        }

        .summary-label {
          font-weight: 600;
          color: #4b5563;
        }

        .summary-value {
          font-family: 'Source Code Pro', monospace;
          font-weight: 600;
          text-align: right;
        }

        .total-row {
          background-color: #f3f4f6;
          font-weight: 700;
        }

        .profit-loss-row {
          background: ${isProfit ? 'linear-gradient(to right, #d1fae5, #a7f3d0)' : 'linear-gradient(to right, #fee2e2, #fecaca)'};
          color: ${isProfit ? '#065f46' : '#7f1d1d'};
          font-weight: 800;
          font-size: 11pt;
        }

        .percentage-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 20px;
          font-size: 9px;
          font-weight: 700;
          margin-left: 8px;
          background: ${isProfit ? '#10b981' : '#ef4444'};
          color: white;
          vertical-align: middle;
        }

        /* Signatures */
        .signatures-section {
          margin: 40px 0;
          padding-top: 25px;
          border-top: 2px dashed #d1d5db;
        }

        .signatures-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          text-align: center;
        }

        .signature-box {
          padding: 20px;
          background: white;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          position: relative;
        }

        .signature-box::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(to right, #3b82f6, #1e40af);
          border-radius: 8px 8px 0 0;
        }

        .signature-role {
          font-size: 11px;
          color: #6b7280;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 25px;
        }

        .signature-line {
          width: 80%;
          height: 1px;
          background: #d1d5db;
          margin: 15px auto;
          position: relative;
        }

        .signature-line::after {
          content: '';
          position: absolute;
          top: -2px;
          left: 0;
          right: 0;
          height: 5px;
          border-top: 1px solid #d1d5db;
          border-bottom: 1px solid #d1d5db;
        }

        .signature-name {
          font-size: 13px;
          font-weight: 700;
          color: #111827;
          margin-top: 10px;
        }

        .signature-date {
          font-size: 9px;
          color: #9ca3af;
          margin-top: 5px;
        }

        /* Footer */
        .footer {
          margin-top: 40px;
          padding: 20px;
          background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
          border-radius: 8px;
          color: white;
          text-align: center;
        }

        .footer h4 {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 10px;
        }

        .footer p {
          font-size: 10px;
          opacity: 0.9;
          margin-bottom: 5px;
        }

        .company-details {
          font-size: 11px;
          font-weight: 600;
          margin-top: 8px;
        }

        /* Status Indicators */
        .status-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 12px;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-left: 8px;
        }

        .status-valid {
          background: #10b981;
          color: white;
        }

        .status-expired {
          background: #ef4444;
          color: white;
        }

        .status-approved {
          background: #3b82f6;
          color: white;
        }

        .status-pending {
          background: #f59e0b;
          color: white;
        }

        /* Notes */
        .notes-section {
          background: #fef3c7;
          border-left: 4px solid #f59e0b;
          border-radius: 6px;
          padding: 18px;
          margin-top: 25px;
          font-size: 9.5pt;
        }

        .notes-title {
          font-size: 12px;
          font-weight: 700;
          color: #92400e;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
        }

        .notes-title::before {
          content: '📝';
          margin-right: 8px;
        }

        .notes-content p {
          margin-bottom: 5px;
          color: #78350f;
        }

        .notes-content strong {
          color: #92400e;
        }

        /* Page Break Control */
        .page-break {
          page-break-before: always;
        }

        /* Print Styles */
        @media print {
          body {
            padding: 0;
            font-size: 9pt;
          }

          .no-print {
            display: none;
          }

          .table-container {
            break-inside: avoid;
          }
        }

        /* Empty States */
        .empty-row {
          text-align: center;
          color: #9ca3af;
          font-style: italic;
          padding: 20px;
          background: #f9fafb;
        }

        /* Utility Classes */
        .mt-1 { margin-top: 4px; }
        .mt-2 { margin-top: 8px; }
        .mt-3 { margin-top: 12px; }
        .mt-4 { margin-top: 16px; }
        .mt-5 { margin-top: 20px; }

        .mb-1 { margin-bottom: 4px; }
        .mb-2 { margin-bottom: 8px; }
        .mb-3 { margin-bottom: 12px; }
        .mb-4 { margin-bottom: 16px; }
        .mb-5 { margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <!-- Header Section -->
      <div class="header">
        <div class="company-info">
          <img src="https://agats.s3.ap-south-1.amazonaws.com/logo/logo.jpeg" alt="Company Logo" class="company-logo">
          <div class="company-name">Alghazal Alabyad Technical Services</div>
          <div class="company-tagline">Professional Technical Solutions & Services</div>
          <div class="company-tagline">Dubai, United Arab Emirates</div>
          <div class="company-tagline">TRN: 123456789123456</div>
        </div>

        <div class="document-title">
          <h1>ESTIMATION</h1>
          <div class="document-number">#${safeGet(estimation.estimationNumber)}</div>
          <div class="document-date">Date: ${formattedCurrentDate}</div>
        </div>
      </div>

      <!-- Client & Estimation Info -->
      <div class="info-grid">
        <div class="info-card">
          <div class="card-header">
            <div class="card-icon">C</div>
            <div class="card-title">Client Information</div>
          </div>
          <div class="info-content">
            <div class="info-item">
              <span class="info-label">Client Name:</span>
              <span class="info-value">${clientName}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Address:</span>
              <span class="info-value">${clientAddress}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Project Location:</span>
              <span class="info-value">${projectLocation}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Building:</span>
              <span class="info-value">${projectBuilding}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Apartment:</span>
              <span class="info-value">${apartmentNumber}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Email:</span>
              <span class="info-value">${clientEmail}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Phone:</span>
              <span class="info-value">${clientPhone}</span>
            </div>
          </div>
        </div>

        <div class="info-card">
          <div class="card-header">
            <div class="card-icon">E</div>
            <div class="card-title">Estimation Details</div>
          </div>
          <div class="info-content">
            <div class="info-item">
              <span class="info-label">Estimation No:</span>
              <span class="info-value">${safeGet(estimation.estimationNumber)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Subject:</span>
              <span class="info-value">${safeGet(estimation.subject)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Valid Until:</span>
              <span class="info-value">
                ${formatOptionalDate(estimation.validUntil)}
                <span class="status-badge ${new Date(estimation.validUntil) > new Date() ? 'status-valid' : 'status-expired'}">
                  ${new Date(estimation.validUntil) > new Date() ? 'VALID' : 'EXPIRED'}
                </span>
              </span>
            </div>
            <div class="info-item">
              <span class="info-label">Payment Terms:</span>
              <span class="info-value">${safeGet(estimation.paymentDueBy, "N/A")} ${estimation.paymentDueBy ? "Days" : ""}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Prepared By:</span>
              <span class="info-value">${preparedBy?.firstName || "N/A"}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Status:</span>
              <span class="info-value">
                ${estimation.isApproved ? 'APPROVED' : estimation.isChecked ? 'CHECKED' : 'DRAFT'}
                <span class="status-badge status-${estimation.isApproved ? 'approved' : estimation.isChecked ? 'pending' : 'pending'}">
                  ${estimation.isApproved ? 'APPROVED' : estimation.isChecked ? 'CHECKED' : 'DRAFT'}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Work Schedule - Only show if dates are provided -->
      ${estimation.workStartDate || estimation.workEndDate || estimation.workDays ? `
      <div class="work-schedule">
        <h3>Work Schedule & Timeline</h3>
        <div class="schedule-grid">
          <div class="schedule-item">
            <div class="schedule-label">Work Start Date</div>
            <div class="schedule-value ${!estimation.workStartDate ? 'to-be-decided' : ''}">
              ${formatOptionalDate(estimation.workStartDate)}
            </div>
          </div>
          <div class="schedule-item">
            <div class="schedule-label">Work End Date</div>
            <div class="schedule-value ${!estimation.workEndDate ? 'to-be-decided' : ''}">
              ${formatOptionalDate(estimation.workEndDate)}
            </div>
          </div>
          <div class="schedule-item">
            <div class="schedule-label">Work Duration</div>
            <div class="schedule-value ${!estimation.workDays || estimation.workDays === 0 ? 'to-be-decided' : ''}">
              ${estimation.workDays && estimation.workDays > 0 ? estimation.workDays + ' Days' : 'To be decided'}
            </div>
          </div>
          <div class="schedule-item">
            <div class="schedule-label">Daily Start Time</div>
            <div class="schedule-value">
              ${formatTimeForPDF(safeGet(estimation.dailyStartTime, "09:00"))}
            </div>
          </div>
          <div class="schedule-item">
            <div class="schedule-label">Daily End Time</div>
            <div class="schedule-value">
              ${formatTimeForPDF(safeGet(estimation.dailyEndTime, "18:00"))}
            </div>
          </div>
          <div class="schedule-item">
            <div class="schedule-label">Daily Working Hours</div>
            <div class="schedule-value">
              ${(() => {
          try {
            if (!estimation.dailyStartTime || !estimation.dailyEndTime) return "N/A";
            const start = new Date(`2000-01-01T${estimation.dailyStartTime}`);
            const end = new Date(`2000-01-01T${estimation.dailyEndTime}`);
            const diffMs = end.getTime() - start.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            return diffHours.toFixed(1) + " Hours";
          } catch {
            return "N/A";
          }
        })()}
            </div>
          </div>
        </div>
      </div>
      ` : ''}

      <!-- Materials Section -->
      <div class="section-header">
        <div>
          <div class="section-title">Materials Breakdown</div>
          <div class="section-subtitle">Detailed list of required materials and costs</div>
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Item Description</th>
              <th>Unit</th>
              <th class="text-right">Quantity</th>
              <th class="text-right">Unit Price (AED)</th>
              <th class="text-right">Total Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            ${(estimation.materials || []).length > 0
        ? estimation.materials.map((material, index) => `
                <tr>
                  <td class="text-center">${index + 1}</td>
                  <td>${safeGet(material.description)}</td>
                  <td>${safeGet(material.uom)}</td>
                  <td class="text-right amount">${safeGetNumber(material.quantity).toFixed(2)}</td>
                  <td class="text-right amount">${safeGetNumber(material.unitPrice).toFixed(2)}</td>
                  <td class="text-right amount">${safeGetNumber(material.total).toFixed(2)}</td>
                </tr>
              `).join("")
        : `<tr><td colspan="6" class="empty-row">No materials listed</td></tr>`
      }
            <tr class="total-row">
              <td colspan="5" class="text-right"><strong>TOTAL MATERIALS</strong></td>
              <td class="text-right amount"><strong>AED ${materialsTotal.toFixed(2)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Labour Charges Section -->
      <div class="section-header">
        <div>
          <div class="section-title">Labour Charges</div>
          <div class="section-subtitle">Manpower requirements and costs</div>
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Designation / Role</th>
              <th class="text-right">Days</th>
              <th class="text-right">Daily Rate (AED)</th>
              <th class="text-right">Total Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            ${(estimation.labour || []).length > 0
        ? estimation.labour.map((labour, index) => `
                <tr>
                  <td class="text-center">${index + 1}</td>
                  <td>${safeGet(labour.designation)}</td>
                  <td class="text-right amount">${safeGetNumber(labour.days).toFixed(2)}</td>
                  <td class="text-right amount">${safeGetNumber(labour.price).toFixed(2)}</td>
                  <td class="text-right amount">${safeGetNumber(labour.total).toFixed(2)}</td>
                </tr>
              `).join("")
        : `<tr><td colspan="5" class="empty-row">No labour charges listed</td></tr>`
      }
            <tr class="total-row">
              <td colspan="4" class="text-right"><strong>TOTAL LABOUR</strong></td>
              <td class="text-right amount"><strong>AED ${labourTotal.toFixed(2)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Miscellaneous Charges Section -->
      <div class="section-header">
        <div>
          <div class="section-title">Miscellaneous Charges</div>
          <div class="section-subtitle">Additional terms, conditions and other costs</div>
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Description</th>
              <th class="text-right">Quantity</th>
              <th class="text-right">Unit Price (AED)</th>
              <th class="text-right">Total Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            ${(estimation.termsAndConditions || []).length > 0
        ? estimation.termsAndConditions.map((term, index) => `
                <tr>
                  <td class="text-center">${index + 1}</td>
                  <td>${safeGet(term.description)}</td>
                  <td class="text-right amount">${safeGetNumber(term.quantity).toFixed(2)}</td>
                  <td class="text-right amount">${safeGetNumber(term.unitPrice).toFixed(2)}</td>
                  <td class="text-right amount">${safeGetNumber(term.total).toFixed(2)}</td>
                </tr>
              `).join("")
        : `<tr><td colspan="5" class="empty-row">No miscellaneous charges listed</td></tr>`
      }
            <tr class="total-row">
              <td colspan="4" class="text-right"><strong>TOTAL MISCELLANEOUS</strong></td>
              <td class="text-right amount"><strong>AED ${termsTotal.toFixed(2)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Financial Summary -->
      <div class="summary-section">
        <div class="summary-title">Financial Summary</div>
        <table class="summary-table">
          <tr>
            <td class="summary-label">Estimated Cost</td>
            <td class="summary-value">AED ${estimatedAmount.toFixed(2)}</td>
          </tr>
          <tr>
            <td class="summary-label">Quotation Amount</td>
            <td class="summary-value">AED ${netAmount.toFixed(2)}</td>
          </tr>
          <tr>
            <td class="summary-label">Commission Amount</td>
            <td class="summary-value">AED ${commissionAmount.toFixed(2)}</td>
          </tr>
          <tr class="profit-loss-row">
            <td class="summary-label">${isProfit ? 'PROFIT' : 'LOSS'}</td>
            <td class="summary-value">
              ${isProfit ? 'AED +' : 'AED -'} ${Math.abs(actualProfit).toFixed(2)}
              <span class="percentage-badge">${profitPercentage}%</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Signatures -->
      <div class="signatures-section">
        <div class="signatures-grid">
          <div class="signature-box">
            <div class="signature-role">Prepared By</div>
            <div class="signature-line"></div>
            <div class="signature-name">${preparedBy?.firstName || "N/A"}</div>
            <div class="signature-date">Date: ${formattedCurrentDate}</div>
          </div>

          <div class="signature-box">
            <div class="signature-role">Checked By</div>
            <div class="signature-line"></div>
            <div class="signature-name">${checkedBy?.firstName || "N/A"}</div>
            <div class="signature-date">Date: ${formattedCurrentDate}</div>
          </div>

          <div class="signature-box">
            <div class="signature-role">Approved By</div>
            <div class="signature-line"></div>
            <div class="signature-name">${approvedBy?.firstName || "N/A"}</div>
            <div class="signature-date">Date: ${formattedCurrentDate}</div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <h4>Thank You For Your Business</h4>
        <p>We appreciate the opportunity to serve you and look forward to working together.</p>
        <div class="company-details">Alghazal Alabyad Technical Services LLC | Dubai, UAE</div>
        <div class="company-details">Tel: +971-4-4102555 | Email: info@alghazalalabyad.com | www.alghazalalabyad.com</div>
      </div>
    </body>
    </html>
  `;

    // Generate PDF with better settings
    const browser = await puppeteer.launch({
      headless: "shell",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--font-render-hinting=none",
        "--disable-font-subpixel-positioning",
      ],
    });

    try {
      const page = await browser.newPage();

      // Set viewport for A4
      await page.setViewport({
        width: 1240,
        height: 1754, // A4 at 96 DPI
        deviceScaleFactor: 2,
      });

      // Set content with proper wait
      await page.setContent(htmlContent, {
        waitUntil: ["networkidle0"],
        timeout: 60000,
      });

      // Wait for fonts to load
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      // Wait for images to load
      await page.waitForSelector('img[src]');

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: '15mm',
          right: '15mm',
          bottom: '15mm',
          left: '15mm'
        },
        scale: 0.95,
        displayHeaderFooter: false,
        timeout: 60000,
      });

      // Set response headers
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="Estimation_${safeGet(estimation.estimationNumber, "unknown")}_${formattedCurrentDate.replace(/[ ,]/g, '_')}.pdf"`
      );
      res.setHeader("Content-Length", pdfBuffer.length);

      res.send(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
);
