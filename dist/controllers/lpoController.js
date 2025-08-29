"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateLPO = exports.getLPOsByProject = exports.deleteLPO = exports.getLPODetails = exports.createLPO = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const lpoModel_1 = require("../models/lpoModel");
const projectModel_1 = require("../models/projectModel");
const uploadConf_1 = require("../utils/uploadConf");
exports.createLPO = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId, lpoDate, supplier, lpoNumber } = req.body;
    const files = req.files;
    // Parse and validate items
    let items = [];
    try {
        items = JSON.parse(req.body.items);
        if (!Array.isArray(items)) {
            throw new Error("Items must be an array");
        }
    }
    catch (err) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid items format - must be valid JSON array");
    }
    // Validate required fields
    if (!projectId || !lpoDate || !supplier || items.length === 0) {
        throw new apiHandlerHelpers_2.ApiError(400, "All required fields must be provided");
    }
    // Validate project exists and has approved quotation
    const project = await projectModel_1.Project.findById(projectId);
    if (!project)
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    if (project.status !== "quotation_sent") {
        throw new apiHandlerHelpers_2.ApiError(400, "Project must have an quotation_sent");
    }
    // Process uploaded documents
    if (!files || files.length === 0) {
        throw new apiHandlerHelpers_2.ApiError(400, "At least one LPO document is required");
    }
    const uploadResult = await (0, uploadConf_1.handleMultipleFileUploads)(files);
    if (!uploadResult.success || !uploadResult.uploadData) {
        throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload LPO documents");
    }
    const documents = uploadResult.uploadData.map((upload, index) => ({
        url: upload.url,
        key: upload.key,
        name: files[index].originalname,
        mimetype: files[index].mimetype,
        size: files[index].size,
    }));
    // Process and validate items
    const processedItems = items.map((item) => {
        if (!item.description || !item.quantity || !item.unitPrice) {
            throw new apiHandlerHelpers_2.ApiError(400, "All item fields are required");
        }
        return {
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            totalPrice: Number(item.quantity) * Number(item.unitPrice),
        };
    });
    // Create LPO
    const lpo = await lpoModel_1.LPO.create({
        project: projectId,
        lpoNumber: lpoNumber,
        lpoDate: new Date(lpoDate),
        supplier,
        items: processedItems,
        documents,
        totalAmount: processedItems.reduce((sum, item) => sum + item.totalPrice, 0),
        createdBy: req.user?.userId,
    });
    await projectModel_1.Project.findByIdAndUpdate(projectId, { status: "lpo_received" });
    res.status(201).json(new apiHandlerHelpers_1.ApiResponse(201, lpo, "LPO created successfully"));
});
// export const getLPOsByProject = asyncHandler(
//   async (req: Request, res: Response) => {
//     const { projectId } = req.params;
//     const lpos = await LPO.find({ project: projectId })
//       .populate("createdBy", "firstName lastName")
//       .sort({ lpoDate: -1 });
//     res
//       .status(200)
//       .json(new ApiResponse(200, lpos, "LPOs retrieved successfully"));
//   }
// );
exports.getLPODetails = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const lpo = await lpoModel_1.LPO.findById(id)
        .populate("project", "projectName client")
        .populate("createdBy", "firstName lastName email");
    if (!lpo) {
        throw new apiHandlerHelpers_2.ApiError(404, "LPO not found");
    }
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, lpo, "LPO details retrieved"));
});
exports.deleteLPO = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const lpo = await lpoModel_1.LPO.findById(id);
    if (!lpo)
        throw new apiHandlerHelpers_2.ApiError(404, "LPO not found");
    // Check if LPO can be deleted
    const project = await projectModel_1.Project.findById(lpo.project);
    if (project && project.status !== "lpo_received") {
        throw new apiHandlerHelpers_2.ApiError(400, "Cannot delete LPO after project has progressed");
    }
    // Delete associated files from S3
    await Promise.all(lpo.documents.map(async (doc) => {
        try {
            await (0, uploadConf_1.deleteFileFromS3)(doc.key);
        }
        catch (err) {
            console.error(`Failed to delete file ${doc.key}:`, err);
        }
    }));
    await lpoModel_1.LPO.findByIdAndDelete(id);
    // Revert project status if needed
    if (project) {
        await projectModel_1.Project.findByIdAndUpdate(lpo.project, {
            status: "quotation_approved",
        });
    }
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, null, "LPO deleted successfully"));
});
// Add this new controller method
exports.getLPOsByProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    // Validate project exists
    const project = await projectModel_1.Project.findById(projectId);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    const lpo = await lpoModel_1.LPO.findOne({ project: projectId })
        .populate("createdBy", "firstName lastName email")
        .sort({ lpoDate: -1, createdAt: -1 });
    console.log(lpo);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, lpo, "LPOs retrieved successfully"));
});
exports.updateLPO = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { projectId, lpoDate, supplier, lpoNumber, existingDocuments } = req.body;
    const files = req.files;
    // Parse and validate items
    let items = [];
    try {
        items = JSON.parse(req.body.items);
        if (!Array.isArray(items)) {
            throw new Error("Items must be an array");
        }
    }
    catch (err) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid items format - must be valid JSON array");
    }
    // Validate required fields
    if (!projectId || !lpoDate || !supplier || items.length === 0) {
        throw new apiHandlerHelpers_2.ApiError(400, "All required fields must be provided");
    }
    // Check if LPO exists
    const existingLPO = await lpoModel_1.LPO.findById(id);
    if (!existingLPO) {
        throw new apiHandlerHelpers_2.ApiError(404, "LPO not found");
    }
    // Process uploaded documents
    let newDocuments = [];
    if (files && files.length > 0) {
        const uploadResult = await (0, uploadConf_1.handleMultipleFileUploads)(files);
        if (!uploadResult.success || !uploadResult.uploadData) {
            throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload LPO documents");
        }
        newDocuments = uploadResult.uploadData.map((upload, index) => ({
            url: upload.url,
            key: upload.key,
            name: files[index].originalname,
            mimetype: files[index].mimetype,
            size: files[index].size,
        }));
    }
    // Process existing documents
    let finalExistingDocuments = [];
    if (existingDocuments) {
        try {
            finalExistingDocuments = JSON.parse(existingDocuments);
        }
        catch (err) {
            throw new apiHandlerHelpers_2.ApiError(400, "Invalid existing documents format");
        }
    }
    // Process and validate items
    const processedItems = items.map((item) => {
        if (!item.description || !item.quantity || !item.unitPrice) {
            throw new apiHandlerHelpers_2.ApiError(400, "All item fields are required");
        }
        return {
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            totalPrice: Number(item.quantity) * Number(item.unitPrice),
        };
    });
    // Delete removed documents from S3
    const documentsToDelete = existingLPO.documents.filter((doc) => !finalExistingDocuments.some((ed) => ed.key === doc.key));
    await Promise.all(documentsToDelete.map(async (doc) => {
        try {
            await (0, uploadConf_1.deleteFileFromS3)(doc.key);
        }
        catch (err) {
            console.error(`Failed to delete file ${doc.key}:`, err);
        }
    }));
    // Update LPO
    const updatedLPO = await lpoModel_1.LPO.findByIdAndUpdate(id, {
        lpoNumber,
        lpoDate: new Date(lpoDate),
        supplier,
        items: processedItems,
        documents: [...finalExistingDocuments, ...newDocuments],
        totalAmount: processedItems.reduce((sum, item) => sum + item.totalPrice, 0),
    }, { new: true, runValidators: true });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, updatedLPO, "LPO updated successfully"));
});
//# sourceMappingURL=lpoController.js.map