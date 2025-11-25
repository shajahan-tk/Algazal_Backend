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
                title: img.title,
                _id: img._id
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
export const replaceWorkCompletionImage = asyncHandler(
    async (req: Request, res: Response) => {
        const { projectId, imageId } = req.params;
        const file = req.file as Express.Multer.File;

        if (!projectId || !imageId) {
            throw new ApiError(400, "Project ID and image ID are required");
        }

        if (!file) {
            throw new ApiError(400, "Image file is required");
        }

        const workCompletion = await WorkCompletion.findOne({ project: projectId });
        if (!workCompletion) {
            throw new ApiError(404, "Work completion not found");
        }

        // Check if user is authorized to update this work completion
        if (workCompletion.createdBy.toString() !== req.user?.userId.toString()) {
            throw new ApiError(403, "Not authorized to update this work completion");
        }

        const imageIndex = workCompletion.images.findIndex(
            (img) => img._id.toString() === imageId
        );

        if (imageIndex === -1) {
            throw new ApiError(404, "Image not found");
        }

        const oldImage = workCompletion.images[imageIndex];

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
        workCompletion.images[imageIndex].imageUrl = newImageData.url;
        workCompletion.images[imageIndex].s3Key = newImageData.key;
        workCompletion.images[imageIndex].uploadedAt = new Date();

        await workCompletion.save();
        const updatedData = await getCompletionDataForProject(projectId);

        res.status(200).json(
            new ApiResponse(200, updatedData, "Image replaced successfully")
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
export const updateWorkCompletionImage = asyncHandler(
    async (req: Request, res: Response) => {
        const { projectId, imageId } = req.params;
        const { title } = req.body;

        if (!projectId || !imageId) {
            throw new ApiError(400, "Project ID and image ID are required");
        }

        if (!title?.trim()) {
            throw new ApiError(400, "Title is required and cannot be empty");
        }

        const workCompletion = await WorkCompletion.findOne({ project: projectId });
        if (!workCompletion) {
            throw new ApiError(404, "Work completion not found");
        }

        // Check if user is authorized to update this work completion
        if (workCompletion.createdBy.toString() !== req.user?.userId.toString()) {
            throw new ApiError(403, "Not authorized to update this work completion");
        }

        const imageIndex = workCompletion.images.findIndex(
            (img) => img._id.toString() === imageId
        );

        if (imageIndex === -1) {
            throw new ApiError(404, "Image not found");
        }

        // Update only the title
        workCompletion.images[imageIndex].title = title.trim();
        await workCompletion.save();

        const updatedData = await getCompletionDataForProject(projectId);

        res.status(200).json(
            new ApiResponse(200, updatedData, "Image title updated successfully")
        );
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
        let workCompletion = await WorkCompletion.findOne({ project: workCompletionId });
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
              margin: 0.5cm;
            }
            * {
                box-sizing: border-box;
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
                align-items: center;
                justify-content: center;
                margin-bottom: 15px;
                gap: 20px;
                page-break-after: avoid;
                padding: 10px 0;
                border-bottom: 3px solid #94d7f4;
                position: relative;
            }
            .logo {
                height: 50px;
                width: auto;
                max-width: 150px;
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
                font-size: 20pt;
                font-weight: bold;
                color: #1a1a1a;
                line-height: 1.3;
                direction: rtl;
                unicode-bidi: bidi-override;
                letter-spacing: 0;
                margin-bottom: 5px;
            }
            .company-name-english {
                font-size: 10pt;
                font-weight: bold;
                color: #1a1a1a;
                line-height: 1.3;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }
            .certificate-title {
                text-align: center;
                font-size: 20pt;
                font-weight: bold;
                color: #2c3e50;
                margin: 20px 0 15px 0;
                text-transform: uppercase;
                letter-spacing: 1.5px;
                padding: 12px;
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                border-radius: 6px;
                border-left: 4px solid #94d7f4;
                border-right: 4px solid #94d7f4;
            }
            .section {
                margin-bottom: 12px;
                page-break-inside: avoid;
            }
            .section-title {
                font-size: 11pt;
                font-weight: bold;
                padding: 4px 0;
                margin: 12px 0 8px 0;
                border-bottom: 2px solid #94d7f4;
                page-break-after: avoid;
                color: #2c3e50;
            }
            .info-table {
                width: 100%;
                border-collapse: collapse;
                margin: 10px 0;
                font-size: 10pt;
            }
            .info-table td {
                padding: 6px 8px;
                vertical-align: top;
                line-height: 1.4;
            }
            .info-table .label {
                font-weight: bold;
                color: #2c3e50;
                width: 30%;
            }
            .highlight {
                padding: 2px 6px;
                background-color: #f0f8ff;
                border-radius: 3px;
                font-weight: 600;
            }
            .certification-text {
                margin: 15px 0;
                padding: 12px 15px;
                background-color: #f8f9fa;
                border-left: 4px solid #94d7f4;
                border-right: 4px solid #94d7f4;
                border-radius: 4px;
                font-size: 10.5pt;
                line-height: 1.6;
                color: #333;
            }
            table.signature-table {
                width: 100%;
                border-collapse: collapse;
                margin: 10px 0;
                font-size: 10pt;
            }
            .signature-table td {
                padding: 10px 12px;
                border: 1px solid #ddd;
                vertical-align: middle;
            }
            .signature-table .header-row {
                background-color: #94d7f4;
                color: #000;
                font-weight: bold;
                text-align: center;
                padding: 8px 12px;
            }
            .signature-table .label-row {
                background-color: #f8f9fa;
                font-weight: bold;
                color: #2c3e50;
                text-align: center;
                padding: 8px 12px;
            }
            .signature-table .value-row {
                text-align: center;
                padding: 12px;
            }
            .signature-table td:nth-child(1) {
                width: 30%;
            }
            .signature-table td:nth-child(2) {
                width: 40%;
            }
            .signature-table td:nth-child(3) {
                width: 30%;
            }
            .signature-img {
                height: 50px;
                max-width: 180px;
                object-fit: contain;
            }
            .empty-signature {
                height: 50px;
                border: 1px dashed #ccc;
                background-color: #f9f9f9;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #999;
                font-size: 9pt;
            }
            .signature-name {
                font-weight: 600;
                color: #2c3e50;
            }
            .green-text {
                color: #228B22;
                font-weight: bold;
            }
            
            /* ==================== IMAGE SECTION (FIXED - NO BREAK PROBLEMS) ==================== */
            
            .images-section {
                margin-top: 15px;
                /* REMOVED: page-break-inside: avoid - Let it break naturally */
            }
            
            .images-grid {
                display: block;
                margin-top: 8px;
                /* REMOVED: page-break-inside rules - Let it flow naturally */
            }
            
            .images-row {
                display: flex;
                gap: 12px;
                margin-bottom: 12px;
                /* REMOVED ALL page-break rules - Let rows break naturally between pages */
                min-height: 140px; /* Ensure minimum height for better breaking */
            }
            
            .image-item {
                flex: 1;
                min-width: calc(33.333% - 8px);
                max-width: calc(33.333% - 8px);
                display: flex;
                flex-direction: column;
                align-items: center;
                /* REMOVED: page-break-inside: avoid - Let items break naturally */
                border: 1px solid #ddd;
                border-radius: 6px;
                padding: 8px;
                background: #fafafa;
                min-height: 140px;
                box-sizing: border-box;
                /* Allow breaking inside image items if needed */
                page-break-inside: auto;
            }
            
            .image-container {
                width: 100%;
                height: 140px;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                margin-bottom: 6px;
                background: #fff;
                border-radius: 4px;
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
                font-size: 8.5pt;
                font-weight: 600;
                text-align: center;
                color: #2c3e50;
                line-height: 1.2;
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
            
            .tagline {
                text-align: center;
                font-weight: bold;
                font-size: 11pt;
               
                color: #2c3e50;
                border-top: 2px solid #ddd;
                padding-top: 10px;
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
            @media print {
                body {
                    font-size: 10pt;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="content">
                <div class="header">
                    <img class="logo" src="https://agats.s3.ap-south-1.amazonaws.com/logo/alghlogo.jpg" alt="Company Logo">
                    <div class="company-names">
                        <div class="company-name-arabic">الغزال الأبيض للخدمات الفنية</div>
                        <div class="company-name-english">AL GHAZAL AL ABYAD TECHNICAL SERVICES</div>
                    </div>
                </div>

                <div class="certificate-title">Completion Certificate</div>

                <div class="section">
                    <table class="info-table">
                        <tr>
                            <td class="label">Reference</td>
                            <td>: <span class="">${`QTN${project.projectNumber.slice(3, 40)}`}</span></td>
                        </tr>
                        <tr>
                            <td class="label">FM CONTRACTOR</td>
                            <td>:&nbsp;${client.clientName}</td>
                        </tr>
                        <tr>
                            <td class="label">SUB CONTRACTOR</td>
                            <td>:&nbsp; AL GHAZAL ALABYAD TECHNICAL SERVICES</td>
                        </tr>
                        <tr>
                            <td class="label">PROJECT DESCRIPTION</td>
                            <td>: <span class="">${project.projectName}</span></td>
                        </tr>
                        <tr>
                            <td class="label">LOCATION (Bldg.)</td>
                            <td>: <span class="">${project.location}${project.building ? `, ${project.building}` : ""}</span></td>
                        </tr>
                    </table>
                </div>

                <div class="certification-text">
                    This is to certify that the work described above in the project description has been cleared out and completed to the required standards and specifications.
                </div>

                <div class="section">
                    <table class="info-table">
                        <tr>
                            <td class="label">Completion Date</td>
                            <td>: <span class="highlight">${formatDate(project.completionDate)}</span></td>
                        </tr>
                        <tr>
                            <td class="label">LPO Number</td>
                            <td>: ${lpo?.lpoNumber || "N/A"}</td>
                        </tr>
                        <tr>
                            <td class="label">LPO Date</td>
                            <td>: ${formatDate(lpo?.lpoDate)}</td>
                        </tr>
                    </table>
                </div>

               

               

                <div class="section">
                    <table class="signature-table">
                        <tr>
                            <td colspan="3" class="header-row">Prepared by: AL GHAZAL AL ABYAD TECHNICAL SERVICES</td>
                        </tr>
                        <tr class="label-row">
                            <td>Name</td>
                            <td>Signature</td>
                            <td>Date</td>
                        </tr>
                        <tr class="value-row">
                            <td>${preparedBy?.firstName || ""} ${preparedBy?.lastName || ""}</td>
                            <td>
                                ${preparedBy?.signatureImage ? `<img src="${preparedBy.signatureImage}" class="signature-img" />` : '<div class="empty-signature">Signature</div>'}
                            </td>
                            <td><span class="green-text">${formatDate(project.handoverDate)}</span></td>
                        </tr>
                    </table>
                </div>
                 <div class="section">
                    <table class="signature-table">
                        <tr>
                            <td colspan="3" class="header-row">Hand over by: AL GHAZAL AL ABYAD TECHNICAL SERVICES</td>
                        </tr>
                        <tr class="label-row">
                            <td>Name</td>
                            <td>Signature</td>
                            <td>Date</td>
                        </tr>
                        <tr class="value-row">
                            <td>${engineer?.firstName} ${engineer?.lastName || ""}</td>
                            <td>
                                ${engineer?.signatureImage ? `<img src="${engineer.signatureImage}" class="signature-img" />` : '<div class="empty-signature">Signature</div>'}
                            </td>
                            <td><span class="green-text">${formatDate(project.handoverDate)}</span></td>
                        </tr>
                    </table>
                </div>
                 <div class="section">
                    <table class="signature-table">
                        <tr>
                            <td colspan="3" class="header-row">Accepted by: Client side</td>
                        </tr>
                        <tr class="label-row">
                            <td>Name</td>
                            <td>Signature</td>
                            <td>Date</td>
                        </tr>
                        <tr class="value-row">
                            <td>${client.clientName}</td>
                            <td>
                                <div class="empty-signature">Client Signature</div>
                            </td>
                            <td>${formatDate(project.acceptanceDate)}</td>
                        </tr>
                    </table>
                </div>

                <!-- IMAGES SECTION -->
                ${workCompletion?.images && workCompletion.images.length > 0 ? `
                  <div class="images-section">
                    <div class="section-title">Site Pictures</div>
                    <div class="images-grid">
                      ${(() => {
                    let html = '';
                    for (let i = 0; i < workCompletion.images.length; i += 3) {
                        const rowImages = workCompletion.images.slice(i, i + 3);
                        html += '<div class="images-row">';

                        for (let j = 0; j < 3; j++) {
                            if (j < rowImages.length) {
                                const image = rowImages[j];
                                html += `
                                <div class="image-item">
                                  <div class="image-container">
                                    <img src="${image.imageUrl}" alt="${image.title || "Site picture"}" />
                                  </div>
                                  <div class="image-title">${image.title || "Site Image"}</div>
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
                  ` : `
                  <div class="section">
                    <div class="section-title">Site Pictures</div>
                    <p style="text-align: center; font-size: 10pt; color: #666; padding: 20px;">No site pictures available</p>
                  </div>
                  `
            }
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
                    top: "0.5cm",
                    right: "0.5cm",
                    bottom: "0.5cm",
                    left: "0.5cm",
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