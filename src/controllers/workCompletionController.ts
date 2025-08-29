import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import {
  IWorkCompletionImage,
  WorkCompletion,
} from "../models/workCompletionModel";
import { IProject, Project } from "../models/projectModel";
import {
  uploadWorkCompletionImagesToS3,
  deleteFileFromS3,
} from "../utils/uploadConf";
import { Client, IClient } from "../models/clientModel";
import { LPO } from "../models/lpoModel";
import { generateRelatedDocumentNumber } from "../utils/documentNumbers";
import puppeteer from "puppeteer";
import { IUser, User } from "../models/userModel";
import { Types } from "mongoose";

// Helper function to get completion data
async function getCompletionDataForProject(projectId: string) {
  type PopulatedProject = Omit<
    IProject,
    "client" | "assignedTo" | "createdBy"
  > & {
    client: IClient;
    assignedTo?: IUser;
    createdBy: IUser;
  };

  const project = await Project.findById(projectId)
    .populate<{ client: IClient }>("client", "clientName")
    .populate<{ assignedTo: IUser }>("assignedTo", "firstName lastName")
    .populate<{ createdBy: IUser }>("createdBy", "firstName lastName");

  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  const populatedProject = project as unknown as PopulatedProject;
  const client = populatedProject.client;
  const lpo = await LPO.findOne({ project: projectId })
    .sort({ createdAt: -1 })
    .limit(1);
  const workCompletion = await WorkCompletion.findOne({ project: projectId })
    .populate("createdBy", "firstName lastName")
    .sort({ createdAt: -1 });

  return {
    _id: populatedProject._id.toString(),
    referenceNumber: `COMP-${populatedProject._id
      .toString()
      .slice(-6)
      .toUpperCase()}`,
    fmContractor: "Al Ghazal Al Abyad Technical Services",
    subContractor: client.clientName,
    projectDescription:
      populatedProject.projectDescription || "No description provided",
    location: `${populatedProject.location}, ${populatedProject.building}, ${populatedProject.apartmentNumber}`,
    completionDate:
      populatedProject.completionDate?.toISOString() ||
      populatedProject.updatedAt?.toISOString() ||
      new Date().toISOString(),
    lpoNumber: lpo?.lpoNumber || "Not available",
    lpoDate: lpo?.lpoDate?.toISOString() || "Not available",
    handover: {
      company: "AL GHAZAL AL ABYAD TECHNICAL SERVICES",
      name: populatedProject.assignedTo
        ? `${populatedProject.assignedTo.firstName} ${populatedProject.assignedTo.lastName}`
        : "Not assigned",
      signature: "",
      date:
        populatedProject.handoverDate?.toISOString() ||
        populatedProject.updatedAt?.toISOString() ||
        new Date().toISOString(),
    },
    acceptance: {
      company: client.clientName,
      name: client.clientName,
      signature: "",
      date:
        populatedProject.acceptanceDate?.toISOString() ||
        new Date().toISOString(),
    },
    sitePictures:
      workCompletion?.images.map((img) => ({
        url: img.imageUrl,
        caption: img.title,
      })) || [],
    project: {
      _id: populatedProject._id.toString(),
      projectName: populatedProject.projectName,
    },
    preparedBy: {
      _id: populatedProject.createdBy._id.toString(),
      firstName: populatedProject.createdBy.firstName,
      lastName: populatedProject.createdBy.lastName,
    },
    createdAt:
      workCompletion?.createdAt?.toISOString() || new Date().toISOString(),
    updatedAt:
      workCompletion?.updatedAt?.toISOString() || new Date().toISOString(),
  };
}

export const createWorkCompletion = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.body;

    if (!projectId) {
      throw new ApiError(400, "Project ID is required");
    }

    const project = await Project.findById(projectId);
    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    const workCompletion = await WorkCompletion.create({
      project: projectId,
      completionNumber: await generateRelatedDocumentNumber(projectId, "WCP"),
      createdBy: req.user?.userId,
    });

    res
      .status(201)
      .json(
        new ApiResponse(
          201,
          workCompletion,
          "Work completion created successfully"
        )
      );
  }
);

export const uploadWorkCompletionImages = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const files = req.files as Express.Multer.File[];
    const { titles = [], descriptions = [] } = req.body;

    if (!projectId) {
      throw new ApiError(400, "Project ID is required");
    }

    if (!files || files.length === 0) {
      throw new ApiError(400, "No images uploaded");
    }

    if (!req.user?.userId) {
      throw new ApiError(401, "Unauthorized");
    }

    const titlesArray: string[] = Array.isArray(titles) ? titles : [titles];
    const descriptionsArray: string[] = Array.isArray(descriptions)
      ? descriptions
      : [descriptions];

    if (titlesArray.length !== files.length) {
      throw new ApiError(400, "Number of titles must match number of images");
    }

    if (titlesArray.some((title) => !title?.trim())) {
      throw new ApiError(400, "All images must have a non-empty title");
    }

    let workCompletion = await WorkCompletion.findOne({ project: projectId });

    if (!workCompletion) {
      workCompletion = await WorkCompletion.create({
        project: projectId,
        createdBy: req.user.userId,
        images: [],
      });
    } else if (
      workCompletion.createdBy.toString() !== req.user.userId.toString()
    ) {
      throw new ApiError(403, "Not authorized to update this work completion");
    }

    const uploadResults = await uploadWorkCompletionImagesToS3(files);

    if (!uploadResults.success || !uploadResults.uploadData) {
      throw new ApiError(500, "Failed to upload images to S3");
    }

    const newImages: any[] = uploadResults.uploadData.map(
      (fileData, index) => ({
        _id: new Types.ObjectId(),
        title: titlesArray[index],
        imageUrl: fileData.url,
        s3Key: fileData.key,
        description: descriptionsArray[index] || "",
        uploadedAt: new Date(),
      })
    );

    workCompletion.images.push(...newImages);
    await workCompletion.save();

    const updatedData = await getCompletionDataForProject(projectId);

    res
      .status(200)
      .json(new ApiResponse(200, updatedData, "Images uploaded successfully"));
  }
);

export const getWorkCompletion = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    if (!projectId) {
      throw new ApiError(400, "Project ID is required");
    }

    const workCompletion = await WorkCompletion.findOne({ project: projectId })
      .populate("createdBy", "firstName lastName")
      .sort({ createdAt: -1 });

    if (!workCompletion) {
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            null,
            "No work completion found for this project"
          )
        );
    }

    const completionData = await getCompletionDataForProject(projectId);

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          completionData,
          "Work completion retrieved successfully"
        )
      );
  }
);

export const deleteWorkCompletionImage = asyncHandler(
  async (req: Request, res: Response) => {
    const { workCompletionId, imageId } = req.params;

    if (!workCompletionId || !imageId) {
      throw new ApiError(400, "Work completion ID and image ID are required");
    }

    const workCompletion = await WorkCompletion.findById(workCompletionId);
    if (!workCompletion) {
      throw new ApiError(404, "Work completion not found");
    }

    if (workCompletion.createdBy.toString() !== req.user?.userId) {
      throw new ApiError(403, "Not authorized to modify this work completion");
    }

    const imageIndex = workCompletion.images.findIndex(
      (img) => img._id.toString() === imageId
    );

    if (imageIndex === -1) {
      throw new ApiError(404, "Image not found");
    }

    const imageToDelete = workCompletion.images[imageIndex];
    const deleteResult = await deleteFileFromS3(imageToDelete.s3Key);

    if (!deleteResult.success) {
      throw new ApiError(500, "Failed to delete image from S3");
    }

    workCompletion.images.splice(imageIndex, 1);
    await workCompletion.save();

    const updatedData = await getCompletionDataForProject(
      workCompletion.project.toString()
    );

    res
      .status(200)
      .json(new ApiResponse(200, updatedData, "Image deleted successfully"));
  }
);

export const getProjectWorkCompletionImages = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    if (!projectId) {
      throw new ApiError(400, "Project ID is required");
    }

    const workCompletion = await WorkCompletion.findOne({ project: projectId })
      .populate("createdBy", "firstName lastName")
      .sort({ createdAt: -1 });

    if (!workCompletion) {
      return res
        .status(200)
        .json(new ApiResponse(200, [], "No work completion images found"));
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          workCompletion.images,
          "Work completion images retrieved successfully"
        )
      );
  }
);

export const getCompletionData = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    if (!projectId) {
      throw new ApiError(400, "Project ID is required");
    }

    const completionData = await getCompletionDataForProject(projectId);

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          completionData,
          "Completion data retrieved successfully"
        )
      );
  }
);

export const updateCompletionDate = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { date } = req.body;

    if (!projectId || !date) {
      throw new ApiError(400, "Project ID and date are required");
    }

    const project = await Project.findByIdAndUpdate(
      projectId,
      { completionDate: new Date(date) },
      { new: true }
    );

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    const updatedData = await getCompletionDataForProject(projectId);
    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          updatedData,
          "Completion date updated successfully"
        )
      );
  }
);

export const updateHandoverDate = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { date } = req.body;

    if (!projectId || !date) {
      throw new ApiError(400, "Project ID and date are required");
    }

    const project = await Project.findByIdAndUpdate(
      projectId,
      { handoverDate: new Date(date) },
      { new: true }
    );

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    const updatedData = await getCompletionDataForProject(projectId);
    res
      .status(200)
      .json(
        new ApiResponse(200, updatedData, "Handover date updated successfully")
      );
  }
);

export const updateAcceptanceDate = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { date } = req.body;

    if (!projectId || !date) {
      throw new ApiError(400, "Project ID and date are required");
    }

    const project = await Project.findByIdAndUpdate(
      projectId,
      { acceptanceDate: new Date(date) },
      { new: true }
    );

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    const updatedData = await getCompletionDataForProject(projectId);
    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          updatedData,
          "Acceptance date updated successfully"
        )
      );
  }
);
export const generateCompletionCertificatePdf = asyncHandler(
  async (req: Request, res: Response) => {
    const { projectId } = req.params;

    if (!projectId) {
      throw new ApiError(400, "Project ID is required");
    }

    // Get all necessary data
    const project = await Project.findById(projectId)
      .populate("client", "clientName")
      .populate("assignedTo", "firstName lastName signatureImage");

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    const client = await Client.findById(project.client);
    if (!client) {
      throw new ApiError(404, "Client not found");
    }

    const lpo = await LPO.findOne({ project: projectId })
      .sort({ createdAt: -1 })
      .limit(1);

    const workCompletion = await WorkCompletion.findOne({ project: projectId })
      .populate("createdBy", "firstName lastName signatureImage")
      .sort({ createdAt: -1 });

    const engineer: any = workCompletion?.createdBy || project.assignedTo;

    // Format dates - updated to use project dates
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

    // Prepare HTML content with optimized spacing
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Completion Certificate</title>
        <style>
            @page {
              size: A4;
              margin: 0.4in;
            }
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 0;
                color: #000;
                border: 1px solid #000;
            }
            .container {
                width: 96%;
                margin: 0 auto;
                padding: 10px;
                padding-bottom: 80px; /* Reduced space for footer */
            }
            .logo-container {
                width: 100%;
                display: flex;
                text-align: center;
                margin-bottom: 10px;
            }
            .logo {
                max-height: 80px;
                width: 100%;
            }
            h1 {
                text-align: center;
                color: purple;
                font-size: 24px;
                font-weight: bold;
                margin: 15px 0;
            }
            .highlight {
                background-color: yellow;
                padding: 1px 3px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 8px 0;
                font-size: 12px;
            }
            td {
                padding: 5px 6px;
                vertical-align: top;
            }
            .bordered {
                border: 1px solid #000;
            }
            .bordered td {
                border: 1px solid #000;
            }
            .bold {
                font-weight: bold;
            }
            .section-title {
                margin: 15px 0 5px 0;
                font-weight: bold;
                font-size: 13px;
            }
            .signature-img {
                height: 40px;
                max-width: 150px;
            }
            .green-text {
                color: green;
                font-weight: bold;
            }
            .blue-text {
                color: #0074cc;
                font-weight: bold;
            }
            .image-container {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin: 10px 0 5px 0;
                justify-content: center;
            }
            .image-container img {
                height: 100px;
                border: 1px solid #000;
                object-fit: cover;
                flex-grow: 1;
                max-width: 180px;
            }
            .footer-container {
                margin-top: 20px;
                width: 96%;
                margin-left: auto;
                margin-right: auto;
                page-break-inside: avoid;
            }
            .tagline {
                text-align: center;
                font-weight: bold;
                font-size: 12pt;
                margin: 10px 0 5px 0;
                color: #333;
            }
            .footer {
                text-align: center;
                font-size: 11px;
                color: #555;
                border-top: 1px solid #ddd;
                padding-top: 8px;
                margin-top: 5px;
            }
            .footer h1 {
                font-size: 16px;
                margin: 5px 0;
                color: #333;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo-container">
                <img src="https://agats.s3.ap-south-1.amazonaws.com/logo/logo.jpeg" alt="Company Logo" class="logo">
            </div>

            <table>
                <tr>
                    <td class="bold" style="width: 30%">Reference</td>
                    <td>: <span class="highlight">${
                      project.projectNumber
                    }</span></td>
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
                    <td>: <span class="highlight">${
                      project.projectName
                    }</span></td>
                </tr>
                <tr>
                    <td class="bold">LOCATION (Bldg.)</td>
                    <td>: <span class="highlight">${project.location}${
      project.building ? `, ${project.building}` : ""
    }</span></td>
                </tr>
            </table>

            <p style="margin: 10px 0; font-size: 12px;">
                This is to certify that the work described above in the project description has been cleared out and completed.
            </p>

            <table>
                <tr>
                    <td class="bold" style="width: 30%">Completion Date</td>
                    <td>: <span class="highlight">${formatDate(
                      project.completionDate
                    )}</span></td>
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

            <table class="bordered" style="margin-top: 15px;">
                <tr>
                    <td colspan="2" class="bold">Hand over by:</td>
                    <td colspan="2">AL GHAZAL AL ABYAD TECHNICAL SERVICES</td>
                </tr>
                <tr>
                    <td class="bold" style="width: 25%">Name:</td>
                    <td style="width: 25%">${engineer?.firstName} ${
      engineer?.lastName || ""
    }</td>
                    <td class="bold" style="width: 25%">Signature:</td>
                    <td style="width: 25%">
                        ${
                          engineer?.signatureImage
                            ? `<img src="${engineer.signatureImage}" class="signature-img" />`
                            : "(signature)"
                        }
                    </td>
                </tr>
                <tr>
                    <td class="bold">Date:</td>
                    <td><span class="green-text">${formatDate(
                      project.handoverDate
                    )}</span></td>
                    <td></td>
                    <td></td>
                </tr>
            </table>

            <table class="bordered" style="margin-top: 15px;">
                <tr>
                    <td colspan="2" class="bold">Accepted by:</td>
                    <td colspan="2" class="blue-text">Client side</td>
                </tr>
                <tr>
                    <td class="bold" style="width: 25%">Name:</td>
                    <td style="width: 25%">${client.clientName}</td>
                    <td class="bold" style="width: 25%">Signature:</td>
                    <td style="width: 25%">(signature)</td>
                </tr>
                <tr>
                    <td class="bold">Date:</td>
                    <td>${formatDate(project.acceptanceDate)}</td>
                    <td></td>
                    <td></td>
                </tr>
            </table>

            <p class="section-title">Site Pictures:</p>
            <div class="image-container">
                ${
                  workCompletion?.images && workCompletion.images.length > 0
                    ? workCompletion.images
                        .map(
                          (image) =>
                            `<img src="${image.imageUrl}" alt="${
                              image.title || "Site picture"
                            }">`
                        )
                        .join("")
                    : '<p style="text-align: center; width: 100%;">No site pictures available</p>'
                }
            </div>
        </div>

        <div class="footer-container">
            <div class="tagline">We work U Relax</div>
            <div class="footer">
                <h1>Completion Certificate</h1>
                <p><strong>AL GHAZAL AL ABYAD TECHNICAL SERVICES</strong></p>
                <p>Office No:04, R09-France Cluster, International City-Dubai | P.O.Box:262760, Dubai-U.A.E</p>
                <p>Tel: 044102555 | <a href="http://www.alghazalgroup.com/">www.alghazalgroup.com</a></p>
                <p>Generated on ${formatDate(new Date())}</p>
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
      await page.setContent(htmlContent, {
        waitUntil: ["networkidle0", "domcontentloaded"],
      });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "0.4in",
          right: "0.4in",
          bottom: "0.4in",
          left: "0.4in",
        },
        preferCSSPageSize: true,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=completion-certificate-${project.projectNumber}.pdf`
      );
      res.send(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
);