import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Vehicle } from "../models/vehicleModel";
import {
  handleMultipleFileUploads,
  deleteFileFromS3,
  getS3KeyFromUrl,
} from "../utils/uploadConf";

export const createVehicle = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      vehicleNumber,
      vehicleType,
      make,
      model, // Frontend sends 'model'
      year,
      color,
      registrationDate,
      insuranceExpiry,
      lastServiceDate,
      currentMileage,
      status,
    } = req.body;

    // Validate required fields
    if (
      !vehicleNumber ||
      !vehicleType ||
      !make ||
      !model || // Validate 'model' from frontend
      !year ||
      !registrationDate ||
      !insuranceExpiry
    ) {
      throw new ApiError(400, "Required fields are missing");
    }

    // Check if vehicle already exists
    const existingVehicle = await Vehicle.findOne({
      vehicleNumber: vehicleNumber.toUpperCase(),
    });
    if (existingVehicle) {
      throw new ApiError(400, "Vehicle with this number already exists");
    }

    // Handle file uploads
    let attachments: {
      fileName: string;
      fileType: string;
      filePath: string;
    }[] = [];

    // Fix for req.files type issue
    const files = Array.isArray(req.files)
      ? req.files
      : Object.values(req.files ?? {}).flat();

    if (files && files.length > 0) {
      const uploadResults = await handleMultipleFileUploads(files);
      if (!uploadResults.success) {
        throw new ApiError(500, "Failed to upload vehicle attachments");
      }
      attachments =
        uploadResults.uploadData?.map((file) => ({
          fileName: file.key.split("/").pop() || "attachment",
          fileType: file.mimetype,
          filePath: file.url,
        })) || [];
    }

    // Create vehicle - map frontend's 'model' to 'vechicleModel'
    const vehicle = await Vehicle.create({
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
      .json(new ApiResponse(201, vehicle, "Vehicle created successfully"));
  }
);

export const getVehicles = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const filter: any = {};

  // Search functionality
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search as string, "i");
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

  const total = await Vehicle.countDocuments(filter);
  const vehicles = await Vehicle.find(filter)
    .skip(skip)
    .limit(limit)
    .sort({ vehicleNumber: 1 })
    .populate("createdBy", "firstName lastName email");

  // Map backend 'vechicleModel' to frontend 'model' in response
  const responseVehicles = vehicles.map((vehicle) => ({
    ...vehicle.toObject(),
    model: vehicle.vechicleModel, // Map to frontend field
  }));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        vehicles: responseVehicles,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      "Vehicles retrieved successfully"
    )
  );
});

export const getVehicle = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const vehicle = await Vehicle.findById(id).populate(
    "createdBy",
    "firstName lastName email"
  );
  if (!vehicle) {
    throw new ApiError(404, "Vehicle not found");
  }

  // Map backend 'vechicleModel' to frontend 'model' in response
  const responseVehicle = {
    ...vehicle.toObject(),
    model: vehicle.vechicleModel,
  };

  res
    .status(200)
    .json(
      new ApiResponse(200, responseVehicle, "Vehicle retrieved successfully")
    );
});

export const updateVehicle = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
      vehicleNumber,
      vehicleType,
      make,
      model, // Frontend sends 'model'
      year,
      color,
      registrationDate,
      insuranceExpiry,
      lastServiceDate,
      currentMileage,
      status,
    } = req.body;

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      throw new ApiError(404, "Vehicle not found");
    }

    // Check if vehicle number is being updated and conflicts with other vehicles
    if (vehicleNumber && vehicleNumber !== vehicle.vehicleNumber) {
      const existingVehicle = await Vehicle.findOne({
        vehicleNumber: vehicleNumber.toUpperCase(),
        _id: { $ne: id },
      });
      if (existingVehicle) {
        throw new ApiError(400, "Another vehicle already uses this number");
      }
    }

    // Handle file uploads for new attachments
    let newAttachments: {
      fileName: string;
      fileType: string;
      filePath: string;
      fileSize?: number;
    }[] = [];

    // Fix for req.files type issue
    const files = Array.isArray(req.files)
      ? req.files
      : req.files
      ? Object.values(req.files).flat()
      : [];

    if (files.length > 0) {
      const uploadResults = await handleMultipleFileUploads(files);
      if (!uploadResults.success) {
        throw new ApiError(500, "Failed to upload new vehicle attachments");
      }
      newAttachments =
        uploadResults.uploadData?.map((file) => ({
          fileName: file.key.split("/").pop() || "attachment",
          fileType: file.mimetype,
          filePath: file.url,
        })) || [];
    }

    // Prepare update data - map frontend 'model' to backend 'vechicleModel'
    const updatePayload: any = {
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

    const updatedVehicle = await Vehicle.findByIdAndUpdate(id, updatePayload, {
      new: true,
    }).populate("createdBy", "firstName lastName email");

    if (!updatedVehicle) {
      throw new ApiError(500, "Failed to update vehicle");
    }

    // Map backend 'vechicleModel' to frontend 'model' in response
    const responseVehicle = {
      ...updatedVehicle.toObject(),
      model: updatedVehicle.vechicleModel,
    };

    res
      .status(200)
      .json(
        new ApiResponse(200, responseVehicle, "Vehicle updated successfully")
      );
  }
);

export const deleteVehicle = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      throw new ApiError(404, "Vehicle not found");
    }

    // Delete all associated files from S3
    if (vehicle.attachments && vehicle.attachments.length > 0) {
      await Promise.all(
        vehicle.attachments.map(async (attachment) => {
          try {
            const key = getS3KeyFromUrl(attachment.filePath);
            await deleteFileFromS3(key);
          } catch (error) {
            console.error(
              `Failed to delete file from S3: ${attachment.filePath}`,
              error
            );
          }
        })
      );
    }

    await Vehicle.findByIdAndDelete(id);

    res
      .status(200)
      .json(new ApiResponse(200, null, "Vehicle deleted successfully"));
  }
);

export const getVehicleByNumber = asyncHandler(
  async (req: Request, res: Response) => {
    const { vehicleNumber } = req.params;

    const vehicle = await Vehicle.findOne({
      vehicleNumber: vehicleNumber.toUpperCase(),
    }).populate("createdBy", "firstName lastName email");
    if (!vehicle) {
      throw new ApiError(404, "Vehicle not found");
    }

    // Map backend 'vechicleModel' to frontend 'model' in response
    const responseVehicle = {
      ...vehicle.toObject(),
      model: vehicle.vechicleModel,
    };

    res
      .status(200)
      .json(
        new ApiResponse(200, responseVehicle, "Vehicle retrieved successfully")
      );
  }
);
