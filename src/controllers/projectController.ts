import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { IProject, Project } from "../models/projectModel";
import { Client, IClient } from "../models/clientModel";
import { Estimation } from "../models/estimationModel";
import { IUser, User } from "../models/userModel";
import { Quotation } from "../models/quotationModel";
import { mailer } from "../utils/mailer";
import { Comment } from "../models/commentModel";
import { LPO } from "../models/lpoModel";
import dayjs from "dayjs";
import mongoose, { Types } from "mongoose";
import { generateProjectNumber } from "../utils/documentNumbers";
import { WorkProgressTemplateParams } from "../template/workProgressEmailTemplate";
import { Expense } from "../models/expenseModel";
import puppeteer from "puppeteer";
import { FRONTEND_URL } from "../config/constant";

// Status transition validation
const validStatusTransitions: Record<string, string[]> = {
  draft: ["estimation_prepared"],
  estimation_prepared: ["quotation_sent", "on_hold", "cancelled"],
  quotation_sent: [
    "quotation_approved",
    "quotation_rejected",
    "on_hold",
    "cancelled",
  ],
  quotation_approved: ["lpo_received", "on_hold", "cancelled"],
  lpo_received: ["work_started", "on_hold", "cancelled"],
  work_started: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["work_completed", "on_hold", "cancelled"],
  work_completed: ["quality_check", "on_hold"],
  quality_check: ["client_handover", "work_completed"],
  client_handover: ["final_invoice_sent", "on_hold"],
  final_invoice_sent: ["payment_received", "on_hold"],
  payment_received: ["project_closed"],
  on_hold: ["in_progress", "work_started", "cancelled"],
  cancelled: [],
  project_closed: [],
  team_assigned: ["work_started", "on_hold"],
};

export const createProject = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      projectName,
      projectDescription,
      client,
      location,
      building,
      apartmentNumber,
    } = req.body;
    console.log(req.body);

    if (!projectName || !client || !location || !building || !apartmentNumber) {
      throw new ApiError(400, "Required fields are missing");
    }

    const clientExists = await Client.findById(client);
    if (!clientExists) {
      throw new ApiError(404, "Client not found");
    }

    const project = await Project.create({
      projectName,
      projectDescription,
      client,
      location,
      building,
      apartmentNumber,
      projectNumber: await generateProjectNumber(),
      status: "draft",
      progress: 0,
      createdBy: req.user?.userId,
    });

    res
      .status(201)
      .json(new ApiResponse(201, project, "Project created successfully"));
  }
);

export const getProjects = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Build filter
  const filter: any = {};

  // Status filter
  if (req.query.status) {
    filter.status = req.query.status;
  }

  // Client filter
  if (req.query.client) {
    filter.client = req.query.client;
  }

  // Search functionality
  if (req.query.search) {
    const searchTerm = req.query.search as string;
    filter.$or = [
      { projectName: { $regex: searchTerm, $options: "i" } },
      { projectDescription: { $regex: searchTerm, $options: "i" } },
      { location: { $regex: searchTerm, $options: "i" } },
      { building: { $regex: searchTerm, $options: "i" } },
      { apartmentNumber: { $regex: searchTerm, $options: "i" } },
      { projectNumber: { $regex: searchTerm, $options: "i" } }, // Added projectNumber to search
    ];
  }

  const total = await Project.countDocuments(filter);

  const projects = await Project.find(filter)
    .populate("client", "clientName clientAddress mobileNumber")
    .populate("createdBy", "firstName lastName email")
    .populate("updatedBy", "firstName lastName email")
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        projects,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      "Projects retrieved successfully"
    )
  );
});

export const getEngineerProjects = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.userId;

    // Validate engineer user
    if (!userId) {
      throw new ApiError(401, "Unauthorized access");
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Build filter - only projects assigned to this engineer
    const filter: any = { assignedTo: userId };

    // Status filter
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Client filter
    if (req.query.client) {
      filter.client = req.query.client;
    }

    // Search functionality
    if (req.query.search) {
      const searchTerm = req.query.search as string;
      filter.$or = [
        { projectName: { $regex: searchTerm, $options: "i" } },
        { projectDescription: { $regex: searchTerm, $options: "i" } },
        { location: { $regex: searchTerm, $options: "i" } },
        { building: { $regex: searchTerm, $options: "i" } },
        { apartmentNumber: { $regex: searchTerm, $options: "i" } },
      ];
    }

    const total = await Project.countDocuments(filter);

    const projects = await Project.find(filter)
      .populate("client", "clientName clientAddress mobileNumber")
      .populate("createdBy", "firstName lastName email")
      .populate("updatedBy", "firstName lastName email")
      .populate("assignedTo", "firstName lastName email")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          projects,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
          },
        },
        "Projects retrieved successfully"
      )
    );
  }
);

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const project = await Project.findById(id)
    .populate("client")
    .populate("createdBy", "firstName lastName email")
    .populate("updatedBy", "firstName lastName email")
    .populate("assignedTo", "-password");

  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  // Check if an estimation exists for this project
  const estimation = await Estimation.findOne({ project: id }).select(
    "_id isChecked isApproved"
  );
  const quotation = await Quotation.findOne({ project: id }).select("_id");
  const Lpo = await LPO.findOne({ project: id }).select("_id");
  const expense = await Expense.findOne({ project: id }).select("_id");
  const responseData = {
    ...project.toObject(),
    estimationId: estimation?._id || null,
    quotationId: quotation?._id || null,
    lpoId: Lpo?._id || null,
    isChecked: estimation?.isChecked || false,
    isApproved: estimation?.isApproved || false,
    expenseId: expense?._id || null,
  };

  res
    .status(200)
    .json(new ApiResponse(200, responseData, "Project retrieved successfully"));
});

export const updateProject = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;
    console.log(updateData);

    // Add updatedBy automatically
    updateData.updatedBy = req.user?.userId;

    const project = await Project.findById(id);
    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Validate progress (0-100)
    if (updateData.progress !== undefined) {
      if (updateData.progress < 0 || updateData.progress > 100) {
        throw new ApiError(400, "Progress must be between 0 and 100");
      }
    }

    // Update status with validation
    if (updateData.status) {
      if (
        !validStatusTransitions[project.status]?.includes(updateData.status)
      ) {
        throw new ApiError(
          400,
          `Invalid status transition from ${project.status} to ${updateData.status}`
        );
      }
    }

    const updatedProject = await Project.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("client", "clientName clientAddress mobileNumber")
      .populate("updatedBy", "firstName lastName email");

    res
      .status(200)
      .json(
        new ApiResponse(200, updatedProject, "Project updated successfully")
      );
  }
);

export const updateProjectStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      throw new ApiError(400, "Status is required");
    }

    const project = await Project.findById(id);
    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Validate status transition
    if (!validStatusTransitions[project.status]?.includes(status)) {
      throw new ApiError(
        400,
        `Invalid status transition from ${project.status} to ${status}`
      );
    }

    const updateData: any = {
      status,
      updatedBy: req.user?.userId,
    };

    const updatedProject = await Project.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          updatedProject,
          "Project status updated successfully"
        )
      );
  }
);

export const assignProject = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { assignedTo } = req.body;

    // Validation
    if (!assignedTo || !id) {
      throw new ApiError(400, "AssignedTo is required");
    }

    // Find project
    const project = await Project.findById(id);
    if (!project) {
      throw new ApiError(400, "Project not found");
    }

    // Find engineer
    const engineer = await User.findById(assignedTo);
    if (!engineer) {
      throw new ApiError(400, "Engineer not found");
    }

    // Update project assignment
    project.assignedTo = assignedTo;
    await project.save();

    try {
      // Get all admin and super_admin users
      const adminUsers = await User.find({
        role: { $in: ["admin", "super_admin"] },
        email: { $exists: true, $ne: "" }, // Only users with emails
      }).select("email firstName");

      // Create list of all recipients (engineer + admins)
      const allRecipients = [
        engineer.email,
        ...adminUsers.map((admin) => admin.email),
      ];

      // Remove duplicates (in case engineer is also an admin)
      const uniqueRecipients = [...new Set(allRecipients)];

      // Send single email to all recipients
      await mailer.sendEmail({
        to: uniqueRecipients.join(","), // Comma-separated list
        subject: `Project Assignment: ${project.projectName}`,
        templateParams: {
          userName: "Team", // Generic since we're sending to multiple people
          actionUrl: `${FRONTEND_URL}/app/project-view/${project._id}`,
          contactEmail: "info@alghazal.ae",
          logoUrl:
            "https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo+alghazal.png",
          projectName: project.projectName || "the project",
        },
        text: `Dear Team,\n\nEngineer ${
          engineer.firstName || "Engineer"
        } has been assigned to project "${
          project.projectName || "the project"
        }".\n\nView project details: ${FRONTEND_URL}/app/project-view/${
          project._id
        }\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
        headers: {
          "X-Priority": "1",
          Importance: "high",
        },
      });

      res
        .status(200)
        .json(
          new ApiResponse(
            200,
            {},
            "Project assigned and notifications sent successfully"
          )
        );
    } catch (emailError) {
      console.error("Email sending failed:", emailError);
      res
        .status(200)
        .json(
          new ApiResponse(
            200,
            {},
            "Project assigned successfully but notification emails failed to send"
          )
        );
    }
  }
);

export const updateProjectProgress = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { progress, comment } = req.body;
    const userId = req.user?.userId;

    if (progress === undefined || progress < 0 || progress > 100) {
      throw new ApiError(400, "Progress must be between 0 and 100");
    }

    const project = await Project.findById(id)
      .populate<{ client: IClient }>("client")
      .populate<{ assignedTo: IUser }>("assignedTo");

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Store old progress for comparison
    const oldProgress = project.progress;

    // Update project status based on progress
    if (project.progress >= 0 && project.status === "team_assigned") {
      project.status = "work_started";
    }
    if (project.progress > 0 && project.status === "work_started") {
      project.status = "in_progress";
    }

    const updateData: any = {
      progress,
      updatedBy: userId,
    };

    // Auto-update status if progress reaches 100%
    if (progress === 100 && project.status !== "work_completed") {
      updateData.status = "work_completed";
    }

    await project.save(); // Save the project first to update its status
    const updatedProject = await Project.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    // Create a progress update comment
    if (comment || progress !== oldProgress) {
      const commentContent =
        comment || `Progress updated from ${oldProgress}% to ${progress}%`;

      await Comment.create({
        content: commentContent,
        user: userId,
        project: id,
        actionType: "progress_update",
        progress: progress,
      });
    }

    // Send progress update email if progress changed
    if (progress !== oldProgress) {
      try {
        // Get all recipients (client + assigned engineer + admins + super_admins)
        const recipients = [];

        // Add client if exists
        if (
          project.client &&
          typeof project.client === "object" &&
          "email" in project.client
        ) {
          recipients.push({
            email: project.client.email,
            name: (project.client as IClient).clientName || "Client",
          });
        }

        // Add assigned engineer if exists
        if (
          project.assignedTo &&
          typeof project.assignedTo === "object" &&
          "email" in project.assignedTo
        ) {
          recipients.push({
            email: project.assignedTo.email,
            name: project.assignedTo.firstName || "Engineer",
          });
        }

        // Add admins and super admins
        const admins = await User.find({
          role: { $in: ["admin", "super_admin"] },
          email: { $exists: true, $ne: "" },
        });
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

        // Get the user who updated the progress
        const updatedByUser = await User.findById(userId);

        // Prepare email content
        const templateParams: WorkProgressTemplateParams = {
          userName: "Team",
          projectName: project.projectName,
          progress: progress,
          progressDetails: comment,
          contactEmail: "info@alghazal.ae",
          logoUrl:
            "https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo+alghazal.png",
          actionUrl: `${FRONTEND_URL}/app/project-view/${project._id}`,
        };

        // Send email to all recipients
        await mailer.sendEmail({
          to: process.env.NOTIFICATION_INBOX || "notifications@company.com",
          bcc: uniqueRecipients.map((r) => r.email).join(","),
          subject: `Progress Update: ${project.projectName} (${progress}% Complete)`,
          templateParams,
          text: `Dear Team,\n\nThe progress for project ${
            project.projectName
          } has been updated to ${progress}%.\n\n${
            comment ? `Details: ${comment}\n\n` : ""
          }View project: ${
            templateParams.actionUrl
          }\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
          headers: {
            "X-Priority": "1",
            Importance: "high",
          },
        });
      } catch (emailError) {
        console.error("Failed to send progress update emails:", emailError);
        // Continue even if email fails
      }
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          updatedProject,
          "Project progress updated successfully"
        )
      );
  }
);
export const getProjectProgressUpdates = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    const progressUpdates = await Comment.find({
      project: projectId,
      actionType: "progress_update",
    })
      .populate("user", "firstName lastName profileImage")
      .sort({ createdAt: -1 });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          progressUpdates,
          "Project progress updates retrieved successfully"
        )
      );
  }
);

export const deleteProject = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const project = await Project.findById(id);
    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Prevent deletion if project is beyond draft stage
    if (project.status !== "draft") {
      throw new ApiError(400, "Cannot delete project that has already started");
    }

    await Project.findByIdAndDelete(id);

    res
      .status(200)
      .json(new ApiResponse(200, null, "Project deleted successfully"));
  }
);
export const generateInvoiceData = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    // Validate projectId
    if (!projectId || !Types.ObjectId.isValid(projectId)) {
      throw new ApiError(400, "Valid project ID is required");
    }

    // Get project data with proper type annotations for populated fields
    const project = await Project.findById(projectId)
      .populate<{ client: IClient }>(
        "client",
        "clientName clientAddress mobileNumber contactPerson trnNumber pincode"
      )
      .populate<{ createdBy: IUser }>("createdBy", "firstName lastName")
      .populate<{ assignedTo: IUser }>("assignedTo", "firstName lastName")
      .lean();

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Get quotation data with validation
    const quotation = await Quotation.findOne({ project: projectId }).lean();
    if (!quotation) {
      throw new ApiError(404, "Quotation not found for this project");
    }

    // Get LPO data with validation
    const lpo = await LPO.findOne({ project: projectId }).lean();
    if (!lpo) {
      throw new ApiError(404, "LPO not found for this project");
    }

    // Validate required fields
    if (!quotation.items || quotation.items.length === 0) {
      throw new ApiError(400, "Quotation items are required");
    }

    // Generate invoice number with better format
    const invoiceNumber = `INV-${dayjs().year()}${String(
      dayjs().month() + 1
    ).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Type-safe client data extraction
    const clientData =
      typeof project.client === "object" ? project.client : null;
    const assignedToData =
      typeof project.assignedTo === "object" ? project.assignedTo : null;
    const createdByData =
      typeof project.createdBy === "object" ? project.createdBy : null;

    // Enhanced vendee information with proper type checking
    const vendeeInfo = {
      name: clientData?.clientName || "IMDAAD LLC",
      contactPerson: assignedToData
        ? `Mr. ${assignedToData.firstName} ${assignedToData.lastName}`
        : clientData?.clientName || "N/A",
      poBox: clientData?.pincode || "18220",
      address: clientData?.clientAddress || "DUBAI - UAE",
      phone: clientData?.mobileNumber || "(04) 812 8888",
      fax: "(04) 881 8405",
      trn: clientData?.trnNumber || "100236819700003",
      grnNumber: project.grnNumber || "N/A",
      supplierNumber: "PO25IMD7595",
      servicePeriod: `${dayjs(project.createdAt).format(
        "DD-MM-YYYY"
      )} to ${dayjs().format("DD-MM-YYYY")}`,
    };

    // Enhanced vendor information
    const vendorInfo = {
      name: "AL GHAZAL AL ABYAD TECHNICAL SERVICES",
      poBox: "63509",
      address: "Dubai - UAE",
      phone: "(04) 4102555",
      fax: "",
      trn: "104037793700003",
    };

    // Enhanced products array
    const products = quotation.items.map((item, index) => ({
      sno: index + 1,
      description: item.description || "N/A",
      qty: item.quantity || 0,
      unitPrice: item.unitPrice || 0,
      total: item.totalPrice || 0,
    }));

    // Enhanced response structure with type-safe checks
    const response = {
      _id: project._id.toString(),
      invoiceNumber,
      date: new Date().toISOString(),
      orderNumber: lpo.lpoNumber || "N/A",
      vendor: vendorInfo,
      vendee: vendeeInfo,
      subject: quotation.scopeOfWork?.join(", ") || "N/A",
      paymentTerms: "90 DAYS",
      amountInWords: convertToWords(quotation.netAmount || 0),
      products,
      summary: {
        amount: quotation.subtotal || 0,
        vat: quotation.vatAmount || 0,
        totalReceivable: quotation.netAmount || 0,
      },
      preparedBy: {
        _id: createdByData?._id.toString() || "",
        firstName: createdByData?.firstName || "N/A",
        lastName: createdByData?.lastName || "N/A",
      },
    };

    res
      .status(200)
      .json(
        new ApiResponse(200, response, "Invoice data generated successfully")
      );
  }
);

// Enhanced number to words conversion
const convertToWords = (num: number): string => {
  const units = [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
  ];
  const teens = [
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "",
    "ten",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];

  if (num === 0) return "Zero UAE Dirhams";

  let words = "";
  // Implementation of number conversion logic here...
  // (Add your full number-to-words implementation)

  return `${words} UAE Dirhams`;
};

// Add to projectController.ts
export const assignTeamAndDriver = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { workers, driverId } = req.body;

    // Validation
    if (!Array.isArray(workers) || workers.length === 0 || !driverId) {
      throw new ApiError(400, "Both workers array and driverId are required");
    }

    const project = await Project.findById(projectId);
    if (!project) throw new ApiError(404, "Project not found");

    // Verify project is in correct state
    if (project.status !== "lpo_received") {
      throw new ApiError(400, "Project must be in 'lpo_received' status");
    }

    // Verify all workers are engineers
    const validWorkers = await User.find({
      _id: { $in: workers },
      role: "worker",
    });
    if (validWorkers.length !== workers.length) {
      throw new ApiError(400, "All workers must be engineers");
    }

    // Verify driver exists
    const driver = await User.findOne({
      _id: driverId,
      role: "driver",
    });
    if (!driver) {
      throw new ApiError(400, "Valid driver ID is required");
    }

    // Update project
    project.assignedWorkers = workers;
    project.assignedDriver = driverId;

    project.status = "team_assigned";

    project.updatedBy = req.user?.userId
      ? new mongoose.Types.ObjectId(req.user.userId)
      : undefined;
    await project.save();

    // Send notifications (implementation depends on your mailer service)
    // await sendAssignmentNotifications(project, workers, driverId);

    res
      .status(200)
      .json(
        new ApiResponse(200, project, "Team and driver assigned successfully")
      );
  }
);

// Helper function for notifications
// const sendAssignmentNotifications = async (
//   project: IProject,
//   workerIds: Types.ObjectId[],
//   driverId: Types.ObjectId
// ) => {
//   try {
//     // Get all involved users (workers + driver + admins)
//     const usersToNotify = await User.find({
//       $or: [
//         { _id: { $in: workerIds } },
//         { _id: driverId },
//         { role: { $in: ["admin", "super_admin"] } },
//       ],
//     });

//     // Send emails
//     await mailer.sendEmail({
//       to: usersToNotify.map((u) => u.email).join(","),
//       subject: `Team Assigned: ${project.projectName}`,
//       templateParams: {
//         projectName: project.projectName,
//         actionUrl: `http://yourfrontend.com/projects/${project._id}`,
//       },
//       text: `You've been assigned to project ${project.projectName}`,
//     });
//   } catch (error) {
//     console.error("Notification error:", error);
//   }
// };
export const getAssignedTeam = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    const project = await Project.findById(projectId)
      .populate("assignedWorkers", "firstName lastName profileImage")
      .populate("assignedDriver", "firstName lastName profileImage");

    if (!project) throw new ApiError(404, "Project not found");

    res.status(200).json(
      new ApiResponse(
        200,
        {
          workers: project.assignedWorkers,
          driver: project.assignedDriver,
        },
        "Assigned team fetched successfully"
      )
    );
  }
);
// Update only workers and driver assignments
export const updateWorkersAndDriver = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { workers, driver } = req.body;

    // Validation
    if (!id) {
      throw new ApiError(400, "Project ID is required");
    }

    // At least one field should be provided
    if (!workers && !driver) {
      throw new ApiError(400, "Either workers or driver must be provided");
    }

    // Find project
    const project = await Project.findById(id);
    if (!project) {
      throw new ApiError(400, "Project not found");
    }

    // Validate and update workers if provided
    if (workers !== undefined) {
      // Explicit check for undefined (empty array is valid)
      if (!Array.isArray(workers)) {
        throw new ApiError(400, "Workers must be an array");
      }

      // If workers array is provided (even empty), validate all IDs
      const workersExist = await User.find({
        _id: { $in: workers },
        role: "worker",
      });

      if (workersExist.length !== workers.length) {
        throw new ApiError(400, "One or more workers not found or not workers");
      }

      project.assignedWorkers = workers;
    }

    // Validate and update driver if provided
    if (driver !== undefined) {
      // Explicit check for undefined (null is valid to clear driver)
      if (driver) {
        const driverExists = await User.findOne({
          _id: driver,
          role: "driver",
        });
        if (!driverExists) {
          throw new ApiError(400, "Driver not found or not a driver");
        }
        project.assignedDriver = driver;
      } else {
        // If driver is explicitly set to null/empty, clear it
        project.assignedDriver = undefined;
      }
    }

    const updatedProject = await project.save();

    // Send notifications

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          updatedProject,
          "Workers and driver assignments updated successfully"
        )
      );
  }
);

// Notification helper specifically for workers/driver updates
// const sendWorkersDriverNotification = async (project: any) => {
//   try {
//     // Get all admin and super_admin users
//     const adminUsers = await User.find({
//       role: { $in: ["admin", "super_admin"] },
//       email: { $exists: true, $ne: "" },
//     }).select("email firstName");

//     // Get all assigned workers and driver details
//     const assignedUsers = await User.find({
//       _id: {
//         $in: [
//           ...(project.driver ? [project.driver] : []),
//           ...(project.workers || []),
//         ].filter(Boolean),
//       },
//     }).select("email firstName role");

//     // Create list of all recipients (assigned users + admins)
//     const allRecipients = [
//       ...adminUsers.map((admin) => admin.email),
//       ...assignedUsers.map((user) => user.email),
//     ];

//     // Remove duplicates
//     const uniqueRecipients = [...new Set(allRecipients)];

//     // Prepare assignment details for email
//     const assignmentDetails = [];
//     if (project.driver) {
//       const driver = assignedUsers.find((u) => u._id.equals(project.driver));
//       if (driver) {
//         assignmentDetails.push(`Driver: ${driver.firstName}`);
//       }
//     }
//     if (project.workers?.length) {
//       const workers = assignedUsers.filter((u) =>
//         project.workers.some((w: any) => u._id.equals(w))
//       );
//       if (workers.length) {
//         assignmentDetails.push(
//           `Workers: ${workers.map((w) => w.firstName).join(", ")}`
//         );
//       }
//     }

//     // Send email if there are recipients and assignments
//     if (uniqueRecipients.length && assignmentDetails.length) {
//       await mailer.sendEmail({
//         to: uniqueRecipients.join(","),
//         subject: `Project Team Update: ${project.projectName}`,
//         templateParams: {
//           userName: "Team",
//           actionUrl: `${process.env.FRONTEND_URL}/app/project-view/${project._id}`,
//           contactEmail: "propertymanagement@alhamra.ae",
//           logoUrl: process.env.LOGO_URL,
//           projectName: project.projectName || "the project",
//           assignmentDetails: assignmentDetails.join("\n"),
//         },
//         text: `Dear Team,\n\nThe team for project "${
//           project.projectName
//         }" has been updated:\n\n${assignmentDetails.join(
//           "\n"
//         )}\n\nView project details: ${
//           process.env.FRONTEND_URL
//         }/app/project-view/${
//           project._id
//         }\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
//         headers: {
//           "X-Priority": "1",
//           Importance: "high",
//         },
//       });
//     }
//   } catch (error) {
//     console.error("Error in sendWorkersDriverNotification:", error);
//     throw error;
//   }
// };

export const getDriverProjects = asyncHandler(
  async (req: Request, res: Response) => {
    const driverId = req.user?.userId;

    if (!driverId) {
      throw new ApiError(401, "Unauthorized access");
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Build filter - only projects assigned to this driver
    const filter: any = { assignedDriver: driverId };

    // Status filter
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Search functionality
    if (req.query.search) {
      const searchTerm = req.query.search as string;
      filter.$or = [
        { projectName: { $regex: searchTerm, $options: "i" } },
        { projectDescription: { $regex: searchTerm, $options: "i" } },
        { location: { $regex: searchTerm, $options: "i" } },
        { building: { $regex: searchTerm, $options: "i" } },
        { apartmentNumber: { $regex: searchTerm, $options: "i" } },
        { projectNumber: { $regex: searchTerm, $options: "i" } },
      ];
    }

    const total = await Project.countDocuments(filter);

    const projects = await Project.find(filter)
      .populate("client", "clientName clientAddress mobileNumber")
      .populate("assignedWorkers", "firstName lastName profileImage")
      .populate("assignedDriver", "firstName lastName profileImage")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          projects,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
          },
        },
        "Driver projects retrieved successfully"
      )
    );
  }
);

export const generateInvoicePdf = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    // Validate projectId
    if (!projectId || !Types.ObjectId.isValid(projectId)) {
      throw new ApiError(400, "Valid project ID is required");
    }

    // Get project data with populated fields
    const project = await Project.findById(projectId)
      .populate<{ client: IClient }>({
        path: "client",
        select: "clientName clientAddress mobileNumber telephoneNumber email trnNumber",
      })
      .populate<{ createdBy: IUser }>(
        "createdBy",
        "firstName lastName signatureImage"
      );

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Get quotation for this project
    const quotation = await Quotation.findOne({ project: projectId });
    if (!quotation) {
      throw new ApiError(404, "Quotation not found for this project");
    }

    // Get LPO data if exists
    const lpo = await LPO.findOne({ project: projectId });

    // Type-safe access to populated fields
    const client = project.client as IClient;
    const createdBy = project.createdBy as IUser;

    // Generate invoice number
    const invoiceNumber = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Format dates
    const formatDate = (date: Date | string | undefined): string => {
      if (!date) return 'N/A';
      const d = new Date(date);
      return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    };

    // Calculate amounts
    const subtotal = quotation.items.reduce(
      (sum, item) => sum + (item.totalPrice || 0),
      0
    );
    const vatAmount = subtotal * (quotation.vatPercentage / 100);
    const totalAmount = subtotal + vatAmount;

    // Helper function to convert amount to words
    const convertToWords = (num: number): string => {
      if (num === 0) return 'Zero AED only';
      
      const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
      const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
      const tens = ['', 'Ten', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

      const convertChunk = (n: number): string => {
        if (n === 0) return '';
        let chunkWords = [];
        
        const hundred = Math.floor(n / 100);
        if (hundred > 0) {
          chunkWords.push(units[hundred] + ' Hundred');
        }
        
        const remainder = n % 100;
        if (remainder > 0) {
          if (remainder < 10) {
            chunkWords.push(units[remainder]);
          } else if (remainder < 20) {
            chunkWords.push(teens[remainder - 10]);
          } else {
            const ten = Math.floor(remainder / 10);
            const unit = remainder % 10;
            chunkWords.push(tens[ten]);
            if (unit > 0) {
              chunkWords.push(units[unit]);
            }
          }
        }
        
        return chunkWords.join(' ');
      };

      const numStr = Math.floor(num).toString();
      const chunks = [];
      for (let i = numStr.length; i > 0; i -= 3) {
        chunks.push(parseInt(numStr.substring(Math.max(0, i - 3), i), 10));
      }

      let words = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkWords = convertChunk(chunks[i]);
        if (chunkWords) {
          words.unshift(chunkWords + (scales[i] ? ' ' + scales[i] : ''));
        }
      }

      const decimal = Math.round((num - Math.floor(num)) * 100);
      let decimalWords = '';
      if (decimal > 0) {
        decimalWords = ' and ' + convertChunk(decimal) + ' Fils';
      }

      const result = words.join(' ') + decimalWords;
      return result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
    };

    // Main HTML content
    const htmlContent = `
<!DOCTYPE html>
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
    .invoice-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #94d7f4;
    }
    .invoice-info {
      text-align: right;
    }
    .client-info-container {
      display: flex;
      margin-bottom: 20px;
    }
    .client-info {
      flex: 1;
      padding: 10px;
      margin-right: 20px;
      border: 1px solid #ddd;
      border-radius: 5px;
    }
    .company-info {
      width: 250px;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 5px;
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
      border-bottom: 1px solid #94d7f4;
      color: #333;
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
    .bank-details {
      margin-top: 20px;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 5px;
    }
    .text-center {
      text-align: center;
    }
    .text-right {
      text-align: right;
    }
    .terms-page {
      page-break-before: always;
      padding-top: 20px;
    }
    .footer {
      font-size: 9pt;
      color: #777;
      text-align: center;
      border-top: 1px solid #ddd;
      padding-top: 10px;
      margin-top: 30px;
    }
      .tagline {
      text-align: center;
      font-weight: bold;
      font-size: 12pt;
      margin: 20px 0 10px 0;
      color: #333;
    }
    .service-period {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #eee;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="header">
    <img class="logo" src="https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/sample-spmc/logo+(1).png" alt="Company Logo">
    <div class="header-content">
      <div class="document-title">TAX INVOICE</div>
    </div>
  </div>

  <div class="invoice-header">
    <div>
      <p><strong>Invoice #:</strong> ${invoiceNumber}</p>
      <p><strong>Date:</strong> ${formatDate(new Date())}</p>
      ${lpo ? `<p><strong>LPO #:</strong> ${lpo.lpoNumber}</p>` : ''}
      ${project.grnNumber ? `<p><strong>GRN #:</strong> ${project.grnNumber}</p>` : ''}
    </div>
    <div class="invoice-info">
      <p><strong>Project:</strong> ${project.projectName || "N/A"}</p>
    </div>
  </div>

  <div class="client-info-container">
    <div class="client-info">
      <h3>BILL TO:</h3>
      <p><strong>Client:</strong> ${client.clientName || "N/A"}</p>
      <p><strong>Address:</strong> ${client.clientAddress || "N/A"}</p>
      <p><strong>Contact:</strong> ${client.mobileNumber || client.telephoneNumber || "N/A"}</p>
      <p><strong>Email:</strong> ${client.email || "N/A"}</p>
      <p><strong>TRN:</strong> ${client.trnNumber || "N/A"}</p>
    </div>

    <div class="company-info">
      <h3>AL GHAZAL AL ABYAD TECHNICAL SERVICES</h3>
      <p>Office No:04, R09-France Cluster</p>
      <p>International City-Dubai</p>
      <p>P.O.Box:262760, Dubai-U.A.E</p>
      <p>Tel: 044102555</p>
      <p>TRN: 104037793700003</p>
      <p class="service-period">
        <strong>SERVICE PERIOD:</strong> 
${formatDate(project.completionDate)} - ${formatDate(project.handoverDate || new Date())}
      </p>
    </div>
  </div>

  <div class="section">
    <div class="section-title">INVOICE ITEMS</div>
    <table>
      <thead>
        <tr>
          <th width="5%">No.</th>
          <th width="45%">Description</th>
          <th width="10%">UOM</th>
          <th width="10%">Qty</th>
          <th width="15%">Unit Price (AED)</th>
          <th width="15%" class="text-right">Total (AED)</th>
        </tr>
      </thead>
      <tbody>
        ${quotation.items.map((item, index) => `
          <tr>
            <td class="text-center">${index + 1}</td>
            <td>${item.description}</td>
            <td class="text-center">${item.uom || "NOS"}</td>
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
        <div class="amount-label">TOTAL AMOUNT:</div>
        <div class="amount-value">${totalAmount.toFixed(2)} AED</div>
      </div>
    </div>
  </div>

  <div class="bank-details">
    <h3>BANK DETAILS</h3>
    <p><strong>Bank Name:</strong> Emirates NBD</p>
    <p><strong>Account Name:</strong> AL GHAZAL AL ABYAD TECHNICAL SERVICES</p>
    <p><strong>Account Number:</strong> 1015489374101</p>
    <p><strong>IBAN:</strong> AE580260001015489374101</p>
    <p><strong>Swift Code:</strong> EBILAEAD</p>
  </div>

  <div class="section">
    <p><strong>Amount in words:</strong> ${convertToWords(totalAmount)} AED only</p>
    <p><strong>Payment Terms:</strong> ${"30 days from invoice date"}</p>
  </div>
    
  

  <div class="footer">
  <div class="tagline">We work U Relax</div>
    <p><strong>AL GHAZAL AL ABYAD TECHNICAL SERVICES</strong></p>
    <p>Office No:04, R09-France Cluster, International City-Dubai | P.O.Box:262760, Dubai-U.A.E</p>
    <p>Tel: 044102555 | <a href="http://www.alghazalgroup.com/">www.alghazalgroup.com</a></p>
    <p>Generated on ${formatDate(new Date())}</p>
  </div>
</body>
</html>
`;

    const browser = await puppeteer.launch({
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
        displayHeaderFooter: false,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=invoice-${invoiceNumber}.pdf`
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
// Helper function to convert numbers to words
function convertToWords1(num: number): string {
  const single = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
  ];
  const double = [
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "Ten",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  const formatTenth = (digit: number, prev: number) => {
    return 0 == digit ? "" : " " + (1 == digit ? double[prev] : tens[digit]);
  };
  const formatOther = (digit: number, next: string, denom: string) => {
    return (
      (0 != digit && 1 != digit
        ? " " + single[digit] + " "
        : " " + single[digit]) +
      (0 != digit ? " " + denom : "") +
      next
    );
  };

  let str = "";
  let rupees = Math.floor(num);
  let paise = Math.floor((num - rupees) * 100);

  if (rupees > 0) {
    const strRupees = rupees.toString();
    const len = strRupees.length;
    let x = 0;

    while (x < len) {
      const digit = parseInt(strRupees[x]);
      const place = len - x;
      switch (place) {
        case 4: // Thousands
          str += formatOther(digit, "", "Thousand");
          break;
        case 3: // Hundreds
          if (digit > 0) {
            str += formatOther(digit, "", "Hundred");
          }
          break;
        case 2: // Tens
          if (digit > 1) {
            str += formatTenth(digit, parseInt(strRupees[x + 1]));
            x++;
          } else if (digit == 1) {
            str += formatTenth(digit, parseInt(strRupees[x + 1]));
            x++;
          }
          break;
        case 1: // Ones
          if (digit > 0) {
            str += " " + single[digit];
          }
          break;
      }
      x++;
    }
    str += " Dirhams";
  }

  if (paise > 0) {
    if (str !== "") {
      str += " and ";
    }
    if (paise < 10) {
      str += single[paise] + " Fils";
    } else if (paise < 20) {
      str += double[paise - 10] + " Fils";
    } else {
      str +=
        tens[Math.floor(paise / 10)] +
        (paise % 10 > 0 ? " " + single[paise % 10] : "") +
        " Fils";
    }
  }

  return str.trim() || "Zero Dirhams";
}

export const addGrnNumber = asyncHandler(
  async (req: Request, res: Response) => {
    const projectId = req.params.projectId;

    if (!projectId) {
      res
        .status(400)
        .json({ message: "projectId is required", success: false });
      return;
    }

    const { grnNumber } = req.body;

    if (!grnNumber) {
      res
        .status(400)
        .json({ message: "grnNumber is required", success: false });
      return;
    }
    const project = await Project.findById(projectId);
    if (!project) {
      res.status(400).json({ message: "project not found", success: false });
      return;
    }
    const updatedProject = await Project.findByIdAndUpdate(
      projectId,
      { grnNumber: grnNumber },
      { new: true }
    );

    if (!updateProject) {
      res
        .status(402)
        .json({ message: "grn Number update failed", success: false });
      return;
    } else {
    }
    res
      .status(200)
      .json({ message: "grn Number update successfully", success: true });
  }
);
