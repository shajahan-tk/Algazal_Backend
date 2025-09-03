import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Shop } from "../models/shopModel";
import { Types } from "mongoose";
import {
  handleMultipleFileUploads,
  deleteFileFromS3,
  getS3KeyFromUrl,
} from "../utils/uploadConf";

export const createShop = asyncHandler(async (req: Request, res: Response) => {
  const { shopName, shopNo, address, vat, ownerName, ownerEmail, contact } =
    req.body;

  // Validate required fields - only shopName, shopNo, address, and contact are required now
  if (!shopName || !shopNo || !address || !contact) {
    throw new ApiError(400, "shopName, shopNo, address, and contact are required");
  }

  // Check if VAT number already exists (only if provided)
  if (vat && vat.trim()) {
    const existingShop = await Shop.findOne({ vat: vat.trim() });
    if (existingShop) {
      throw new ApiError(400, "Shop with this VAT number already exists");
    }
  }

  // Check if shop number already exists
  const existingShopNo = await Shop.findOne({ shopNo });
  if (existingShopNo) {
    throw new ApiError(400, "Shop with this number already exists");
  }

  // Handle file uploads
  let shopAttachments: {
    fileName: string;
    fileType: string;
    filePath: string;
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
      throw new ApiError(500, "Failed to upload shop attachments");
    }
    shopAttachments =
      uploadResults.uploadData?.map((file) => ({
        fileName: file.key.split("/").pop() || "attachment",
        fileType: file.mimetype,
        filePath: file.url,
      })) || [];
  }

  const shop = await Shop.create({
    shopName,
    shopNo,
    address,
    vat: vat && vat.trim() ? vat.trim() : undefined, // Only set if provided and not empty
    ownerName: ownerName && ownerName.trim() ? ownerName.trim() : undefined, // Only set if provided and not empty
    ownerEmail,
    contact,
    shopAttachments,
    createdBy: req.user?.userId,
  });

  res.status(201).json(new ApiResponse(201, shop, "Shop created successfully"));
});

export const getShops = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const filter: any = {};

  // Search functionality
  if (req.query.search) {
    const searchConditions: any[] = [
      { shopName: { $regex: req.query.search, $options: "i" } },
      { contact: { $regex: req.query.search, $options: "i" } },
      { shopNo: { $regex: req.query.search, $options: "i" } },
      { address: { $regex: req.query.search, $options: "i" } },
      { vat: { $regex: req.query.search, $options: "i" } },
      { ownerName: { $regex: req.query.search, $options: "i" } }
    ];
    
    filter.$or = searchConditions;
  }

  const total = await Shop.countDocuments(filter);
  const shops = await Shop.find(filter)
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 })
    .populate("createdBy", "firstName lastName email");

  res.status(200).json(
    new ApiResponse(
      200,
      {
        shops,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      "Shops retrieved successfully"
    )
  );
});

export const getShop = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const shop = await Shop.findById(id).populate(
    "createdBy",
    "firstName lastName email"
  );
  if (!shop) {
    throw new ApiError(404, "Shop not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, shop, "Shop retrieved successfully"));
});

export const updateShop = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { shopName, shopNo, address, vat, ownerName, ownerEmail, contact } =
    req.body;

  const shop = await Shop.findById(id);
  if (!shop) {
    throw new ApiError(404, "Shop not found");
  }

  // Check if VAT is being updated and conflicts with other shops (only if provided)
  if (vat !== undefined) {
    if (vat && vat.trim() && vat.trim() !== shop.vat) {
      const existingShop = await Shop.findOne({
        vat: vat.trim(),
        _id: { $ne: id },
      });

      if (existingShop) {
        throw new ApiError(400, "Another shop already uses this VAT number");
      }
    }
  }

  // Check if shop number is being updated and conflicts with other shops
  if (shopNo && shopNo !== shop.shopNo) {
    const existingShopNo = await Shop.findOne({
      shopNo,
      _id: { $ne: id },
    });

    if (existingShopNo) {
      throw new ApiError(400, "Another shop already uses this shop number");
    }
  }

  // Handle file uploads for new attachments
  let newAttachments: {
    fileName: string;
    fileType: string;
    filePath: string;
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
      throw new ApiError(500, "Failed to upload new shop attachments");
    }
    newAttachments =
      uploadResults.uploadData?.map((file) => ({
        fileName: file.key.split("/").pop() || "attachment",
        fileType: file.mimetype,
        filePath: file.url,
      })) || [];
  }

  // Prepare update object
  const updateData: any = {};
  
  if (shopName !== undefined) updateData.shopName = shopName;
  if (shopNo !== undefined) updateData.shopNo = shopNo;
  if (address !== undefined) updateData.address = address;
  if (contact !== undefined) updateData.contact = contact;
  
  // Handle optional fields - set to undefined if empty string, otherwise use provided value
  if (vat !== undefined) {
    updateData.vat = vat && vat.trim() ? vat.trim() : undefined;
  }
  if (ownerName !== undefined) {
    updateData.ownerName = ownerName && ownerName.trim() ? ownerName.trim() : undefined;
  }
  if (ownerEmail !== undefined) {
    updateData.ownerEmail = ownerEmail && ownerEmail.trim() ? ownerEmail.trim() : undefined;
  }

  const updatedShop = await Shop.findByIdAndUpdate(
    id,
    {
      ...updateData,
      $push: { shopAttachments: { $each: newAttachments } },
    },
    { new: true }
  );

  if (!updatedShop) {
    throw new ApiError(500, "Failed to update shop");
  }

  res
    .status(200)
    .json(new ApiResponse(200, updatedShop, "Shop updated successfully"));
});

export const deleteShop = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const shop = await Shop.findById(id);
  if (!shop) {
    throw new ApiError(404, "Shop not found");
  }

  // Delete all associated files from S3
  if (shop.shopAttachments && shop.shopAttachments.length > 0) {
    await Promise.all(
      shop.shopAttachments.map(async (attachment) => {
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

  await Shop.findByIdAndDelete(id);

  res.status(200).json(new ApiResponse(200, null, "Shop deleted successfully"));
});

export const getShopByVat = asyncHandler(
  async (req: Request, res: Response) => {
    const { vatNumber } = req.params;

    const shop = await Shop.findOne({ vat: vatNumber }).populate(
      "createdBy",
      "firstName lastName email"
    );
    if (!shop) {
      throw new ApiError(404, "Shop not found");
    }

    res
      .status(200)
      .json(new ApiResponse(200, shop, "Shop retrieved successfully"));
  }
);

export const getShopsByPincode = asyncHandler(
  async (req: Request, res: Response) => {
    const { pincode } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    if (!/^[0-9]{6}$/.test(pincode)) {
      throw new ApiError(400, "Invalid pincode format");
    }

    const total = await Shop.countDocuments({
      address: { $regex: pincode, $options: "i" },
    });

    const shops = await Shop.find({
      address: { $regex: pincode, $options: "i" },
    })
      .skip(skip)
      .limit(limit)
      .sort({ shopName: 1 })
      .populate("createdBy", "firstName lastName email");

    res.status(200).json(
      new ApiResponse(
        200,
        {
          shops,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
          },
        },
        "Shops retrieved successfully"
      )
    );
  }
);

// Additional helper methods if needed
const deleteShopAttachments = async (attachments: any[]) => {
  if (!attachments || attachments.length === 0) return;

  await Promise.all(
    attachments.map(async (attachment) => {
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
};