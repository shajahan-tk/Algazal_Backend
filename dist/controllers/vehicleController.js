"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVehicleByNumber = exports.deleteVehicle = exports.updateVehicle = exports.getVehicle = exports.getVehicles = exports.createVehicle = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const vehicleModel_1 = require("../models/vehicleModel");
const uploadConf_1 = require("../utils/uploadConf");
exports.createVehicle = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { vehicleNumber, vehicleType, make, model, // Frontend sends 'model'
    year, color, registrationDate, insuranceExpiry, lastServiceDate, currentMileage, status, } = req.body;
    // Validate required fields
    if (!vehicleNumber ||
        !vehicleType ||
        !make ||
        !model || // Validate 'model' from frontend
        !year ||
        !registrationDate ||
        !insuranceExpiry) {
        throw new apiHandlerHelpers_2.ApiError(400, "Required fields are missing");
    }
    // Check if vehicle already exists
    const existingVehicle = await vehicleModel_1.Vehicle.findOne({
        vehicleNumber: vehicleNumber.toUpperCase(),
    });
    if (existingVehicle) {
        throw new apiHandlerHelpers_2.ApiError(400, "Vehicle with this number already exists");
    }
    // Handle file uploads
    let attachments = [];
    // Fix for req.files type issue
    const files = Array.isArray(req.files)
        ? req.files
        : Object.values(req.files ?? {}).flat();
    if (files && files.length > 0) {
        const uploadResults = await (0, uploadConf_1.handleMultipleFileUploads)(files);
        if (!uploadResults.success) {
            throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload vehicle attachments");
        }
        attachments =
            uploadResults.uploadData?.map((file) => ({
                fileName: file.key.split("/").pop() || "attachment",
                fileType: file.mimetype,
                filePath: file.url,
            })) || [];
    }
    // Create vehicle - map frontend's 'model' to 'vechicleModel'
    const vehicle = await vehicleModel_1.Vehicle.create({
        vehicleNumber: vehicleNumber.toUpperCase(),
        vehicleType,
        make,
        vechicleModel: model, // Map to backend field
        year,
        color,
        registrationDate: new Date(registrationDate),
        insuranceExpiry: new Date(insuranceExpiry),
        lastServiceDate: lastServiceDate ? new Date(lastServiceDate) : undefined,
        currentMileage: currentMileage || 0,
        status: status || "active",
        attachments,
        createdBy: req.user?.userId,
    });
    res
        .status(201)
        .json(new apiHandlerHelpers_1.ApiResponse(201, vehicle, "Vehicle created successfully"));
});
exports.getVehicles = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = {};
    // Search functionality
    if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, "i");
        filter.$or = [
            { vehicleNumber: searchRegex },
            { make: searchRegex },
            { vechicleModel: searchRegex }, // Search on backend field
        ];
    }
    // Status filter
    if (req.query.status) {
        filter.status = req.query.status;
    }
    const total = await vehicleModel_1.Vehicle.countDocuments(filter);
    const vehicles = await vehicleModel_1.Vehicle.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ vehicleNumber: 1 })
        .populate("createdBy", "firstName lastName email");
    // Map backend 'vechicleModel' to frontend 'model' in response
    const responseVehicles = vehicles.map((vehicle) => ({
        ...vehicle.toObject(),
        model: vehicle.vechicleModel, // Map to frontend field
    }));
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        vehicles: responseVehicles,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Vehicles retrieved successfully"));
});
exports.getVehicle = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const vehicle = await vehicleModel_1.Vehicle.findById(id).populate("createdBy", "firstName lastName email");
    if (!vehicle) {
        throw new apiHandlerHelpers_2.ApiError(404, "Vehicle not found");
    }
    // Map backend 'vechicleModel' to frontend 'model' in response
    const responseVehicle = {
        ...vehicle.toObject(),
        model: vehicle.vechicleModel,
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, responseVehicle, "Vehicle retrieved successfully"));
});
exports.updateVehicle = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { vehicleNumber, vehicleType, make, model, // Frontend sends 'model'
    year, color, registrationDate, insuranceExpiry, lastServiceDate, currentMileage, status, } = req.body;
    const vehicle = await vehicleModel_1.Vehicle.findById(id);
    if (!vehicle) {
        throw new apiHandlerHelpers_2.ApiError(404, "Vehicle not found");
    }
    // Check if vehicle number is being updated and conflicts with other vehicles
    if (vehicleNumber && vehicleNumber !== vehicle.vehicleNumber) {
        const existingVehicle = await vehicleModel_1.Vehicle.findOne({
            vehicleNumber: vehicleNumber.toUpperCase(),
            _id: { $ne: id },
        });
        if (existingVehicle) {
            throw new apiHandlerHelpers_2.ApiError(400, "Another vehicle already uses this number");
        }
    }
    // Handle file uploads for new attachments
    let newAttachments = [];
    // Fix for req.files type issue
    const files = Array.isArray(req.files)
        ? req.files
        : req.files
            ? Object.values(req.files).flat()
            : [];
    if (files.length > 0) {
        const uploadResults = await (0, uploadConf_1.handleMultipleFileUploads)(files);
        if (!uploadResults.success) {
            throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload new vehicle attachments");
        }
        newAttachments =
            uploadResults.uploadData?.map((file) => ({
                fileName: file.key.split("/").pop() || "attachment",
                fileType: file.mimetype,
                filePath: file.url,
            })) || [];
    }
    // Prepare update data - map frontend 'model' to backend 'vechicleModel'
    const updatePayload = {
        vehicleNumber: vehicleNumber
            ? vehicleNumber.toUpperCase()
            : vehicle.vehicleNumber,
        vehicleType: vehicleType || vehicle.vehicleType,
        make: make || vehicle.make,
        vechicleModel: model || vehicle.vechicleModel, // Map to backend field
        year: year || vehicle.year,
        color: color !== undefined ? color : vehicle.color,
        registrationDate: registrationDate
            ? new Date(registrationDate)
            : vehicle.registrationDate,
        insuranceExpiry: insuranceExpiry
            ? new Date(insuranceExpiry)
            : vehicle.insuranceExpiry,
        lastServiceDate: lastServiceDate
            ? new Date(lastServiceDate)
            : vehicle.lastServiceDate,
        currentMileage: currentMileage || vehicle.currentMileage,
        status: status || vehicle.status,
        $push: { attachments: { $each: newAttachments } },
    };
    const updatedVehicle = await vehicleModel_1.Vehicle.findByIdAndUpdate(id, updatePayload, {
        new: true,
    }).populate("createdBy", "firstName lastName email");
    if (!updatedVehicle) {
        throw new apiHandlerHelpers_2.ApiError(500, "Failed to update vehicle");
    }
    // Map backend 'vechicleModel' to frontend 'model' in response
    const responseVehicle = {
        ...updatedVehicle.toObject(),
        model: updatedVehicle.vechicleModel,
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, responseVehicle, "Vehicle updated successfully"));
});
exports.deleteVehicle = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const vehicle = await vehicleModel_1.Vehicle.findById(id);
    if (!vehicle) {
        throw new apiHandlerHelpers_2.ApiError(404, "Vehicle not found");
    }
    // Delete all associated files from S3
    if (vehicle.attachments && vehicle.attachments.length > 0) {
        await Promise.all(vehicle.attachments.map(async (attachment) => {
            try {
                const key = (0, uploadConf_1.getS3KeyFromUrl)(attachment.filePath);
                await (0, uploadConf_1.deleteFileFromS3)(key);
            }
            catch (error) {
                console.error(`Failed to delete file from S3: ${attachment.filePath}`, error);
            }
        }));
    }
    await vehicleModel_1.Vehicle.findByIdAndDelete(id);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, null, "Vehicle deleted successfully"));
});
exports.getVehicleByNumber = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { vehicleNumber } = req.params;
    const vehicle = await vehicleModel_1.Vehicle.findOne({
        vehicleNumber: vehicleNumber.toUpperCase(),
    }).populate("createdBy", "firstName lastName email");
    if (!vehicle) {
        throw new apiHandlerHelpers_2.ApiError(404, "Vehicle not found");
    }
    // Map backend 'vechicleModel' to frontend 'model' in response
    const responseVehicle = {
        ...vehicle.toObject(),
        model: vehicle.vechicleModel,
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, responseVehicle, "Vehicle retrieved successfully"));
});
//# sourceMappingURL=vehicleController.js.map