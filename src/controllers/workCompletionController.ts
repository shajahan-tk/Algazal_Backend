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
      completionNumber: await generateRelatedDocumentNumber(projectId, "WCPAGA"),
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

    const engineer: any = project.assignedTo;
    const preparedBy: any = workCompletion?.createdBy;

    // Format dates
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

    // Prepare HTML content
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
            * {
                box-sizing: border-box;
            }
            body {
                font-family: Arial, sans-serif;
                margin: 0;
               
                color: #000;
                font-size: 11pt;
                line-height: 1.5;
                background-color: #fff;
            }
            .certificate-wrapper {
                border: 1px solid #000;
                padding: 25px;
                min-height: 95vh;
                background-color: #fff;
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
            .bordered tr:nth-child(even) {
                background-color: #f8f9fa;
            }
        </style>
    </head>
    <body>
        <div class="certificate-wrapper">
            <div class="header">
                <img src="https://agats.s3.ap-south-1.amazonaws.com/logo/alghlogo.jpg" alt="Company Logo" class="logo">
                <div class="title-container">
                    <h1>Completion Certificate</h1>
                </div>
            </div>

            <table>
                <tr>
                    <td class="bold" style="width: 30%">Reference</td>
                    <td>: <span class="highlight">${
                      `QTN${project.projectNumber.slice(3,40)}`
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

            <div class="certification-text">
                This is to certify that the work described above in the project description has been cleared out and completed to the required standards and specifications.
            </div>

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

            <table class="bordered">
                <tr>
                    <td colspan="2" class="blue-bg">Hand over by:</td>
                    <td colspan="2" class="blue-bg">AL GHAZAL AL ABYAD TECHNICAL SERVICES</td>
                </tr>
                <tr>
                    <td class="bold" style="width: 25%">Name:</td>
                    <td style="width: 25%" class="signature-name">${engineer?.firstName} ${
      engineer?.lastName || ""
    }</td>
                    <td class="bold" style="width: 25%">Signature:</td>
                    <td style="width: 25%" class="signature-section">
                        ${
                          engineer?.signatureImage
                            ? `<img src="${engineer.signatureImage}" class="signature-img" />`
                            : '<div class="empty-signature">Signature</div>'
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
                    <td style="width: 25%" class="signature-name">${preparedBy?.firstName || ""} ${
      preparedBy?.lastName || ""
    }</td>
                    <td class="bold" style="width: 25%">Signature:</td>
                    <td style="width: 25%" class="signature-section">
                        ${
                          preparedBy?.signatureImage
                            ? `<img src="${preparedBy.signatureImage}" class="signature-img" />`
                            : '<div class="empty-signature">Signature</div>'
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

            <div class="section-title">Site Pictures:</div>
            <div class="image-container">
                ${
                  workCompletion?.images && workCompletion.images.length > 0
                    ? workCompletion.images
                        .map(
                          (image) =>
                            `<div class="image-item">
                               <img src="${image.imageUrl}" alt="${image.title || "Site picture"}" />
                               <div class="image-title">${image.title || "Site Image"}</div>
                             </div>`
                        )
                        .join("")
                    : '<p style="text-align: center; width: 100%; font-size: 11pt; color: #666; padding: 20px;">No site pictures available</p>'
                }
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
        </div>
    </body>
    </html>
    `;

    // Generate PDF
    const browser = await puppeteer.launch({
      headless: "shell",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
    });

    try {
      const page = await browser.newPage();
      
      await page.setViewport({ width: 1200, height: 1600 });
      
      await page.setContent(htmlContent, {
        waitUntil: ["networkidle0", "domcontentloaded"],
        timeout: 30000,
      });

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
        displayHeaderFooter: false,
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

///ads