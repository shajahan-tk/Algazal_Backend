"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShopsByPincode = exports.getShopByVat = exports.deleteShop = exports.updateShop = exports.getShop = exports.getShops = exports.createShop = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const shopModel_1 = require("../models/shopModel");
const uploadConf_1 = require("../utils/uploadConf");
exports.createShop = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { shopName, shopNo, address, vat, ownerName, ownerEmail, contact } = req.body;
    // Validate required fields
    if (!shopName || !shopNo || !address || !vat || !ownerName || !contact) {
        throw new apiHandlerHelpers_2.ApiError(400, "All fields except ownerEmail are required");
    }
    // Check if VAT number already exists
    const existingShop = await shopModel_1.Shop.findOne({ vat });
    if (existingShop) {
        throw new apiHandlerHelpers_2.ApiError(400, "Shop with this VAT number already exists");
    }
    // Check if shop number already exists
    const existingShopNo = await shopModel_1.Shop.findOne({ shopNo });
    if (existingShopNo) {
        throw new apiHandlerHelpers_2.ApiError(400, "Shop with this number already exists");
    }
    // Handle file uploads
    let shopAttachments = [];
    // Fix for req.files type issue
    const files = Array.isArray(req.files)
        ? req.files
        : req.files
            ? Object.values(req.files).flat()
            : [];
    if (files.length > 0) {
        const uploadResults = await (0, uploadConf_1.handleMultipleFileUploads)(files);
        if (!uploadResults.success) {
            throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload shop attachments");
        }
        shopAttachments =
            uploadResults.uploadData?.map((file) => ({
                fileName: file.key.split("/").pop() || "attachment",
                fileType: file.mimetype,
                filePath: file.url,
            })) || [];
    }
    const shop = await shopModel_1.Shop.create({
        shopName,
        shopNo,
        address,
        vat,
        ownerName,
        ownerEmail,
        contact,
        shopAttachments,
        createdBy: req.user?.userId,
    });
    res.status(201).json(new apiHandlerHelpers_1.ApiResponse(201, shop, "Shop created successfully"));
});
exports.getShops = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = {};
    // Search functionality
    if (req.query.search) {
        filter.$or = [
            { shopName: { $regex: req.query.search, $options: "i" } },
            { vat: { $regex: req.query.search, $options: "i" } },
            { contact: { $regex: req.query.search, $options: "i" } },
            { ownerName: { $regex: req.query.search, $options: "i" } },
            { shopNo: { $regex: req.query.search, $options: "i" } },
            { address: { $regex: req.query.search, $options: "i" } },
        ];
    }
    const total = await shopModel_1.Shop.countDocuments(filter);
    const shops = await shopModel_1.Shop.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate("createdBy", "firstName lastName email");
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        shops,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Shops retrieved successfully"));
});
exports.getShop = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const shop = await shopModel_1.Shop.findById(id).populate("createdBy", "firstName lastName email");
    if (!shop) {
        throw new apiHandlerHelpers_2.ApiError(404, "Shop not found");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, shop, "Shop retrieved successfully"));
});
exports.updateShop = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { shopName, shopNo, address, vat, ownerName, ownerEmail, contact } = req.body;
    const shop = await shopModel_1.Shop.findById(id);
    if (!shop) {
        throw new apiHandlerHelpers_2.ApiError(404, "Shop not found");
    }
    // Check if VAT is being updated and conflicts with other shops
    if (vat && vat !== shop.vat) {
        const existingShop = await shopModel_1.Shop.findOne({
            vat,
            _id: { $ne: id },
        });
        if (existingShop) {
            throw new apiHandlerHelpers_2.ApiError(400, "Another shop already uses this VAT number");
        }
    }
    // Check if shop number is being updated and conflicts with other shops
    if (shopNo && shopNo !== shop.shopNo) {
        const existingShopNo = await shopModel_1.Shop.findOne({
            shopNo,
            _id: { $ne: id },
        });
        if (existingShopNo) {
            throw new apiHandlerHelpers_2.ApiError(400, "Another shop already uses this shop number");
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
            throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload new shop attachments");
        }
        newAttachments =
            uploadResults.uploadData?.map((file) => ({
                fileName: file.key.split("/").pop() || "attachment",
                fileType: file.mimetype,
                filePath: file.url,
            })) || [];
    }
    const updatedShop = await shopModel_1.Shop.findByIdAndUpdate(id, {
        shopName: shopName || shop.shopName,
        shopNo: shopNo || shop.shopNo,
        address: address || shop.address,
        vat: vat || shop.vat,
        ownerName: ownerName || shop.ownerName,
        ownerEmail: ownerEmail !== undefined ? ownerEmail : shop.ownerEmail,
        contact: contact || shop.contact,
        $push: { shopAttachments: { $each: newAttachments } },
    }, { new: true });
    if (!updatedShop) {
        throw new apiHandlerHelpers_2.ApiError(500, "Failed to update shop");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedShop, "Shop updated successfully"));
});
exports.deleteShop = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const shop = await shopModel_1.Shop.findById(id);
    if (!shop) {
        throw new apiHandlerHelpers_2.ApiError(404, "Shop not found");
    }
    // Delete all associated files from S3
    if (shop.shopAttachments && shop.shopAttachments.length > 0) {
        await Promise.all(shop.shopAttachments.map(async (attachment) => {
            try {
                const key = (0, uploadConf_1.getS3KeyFromUrl)(attachment.filePath);
                await (0, uploadConf_1.deleteFileFromS3)(key);
            }
            catch (error) {
                console.error(`Failed to delete file from S3: ${attachment.filePath}`, error);
            }
        }));
    }
    await shopModel_1.Shop.findByIdAndDelete(id);
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, null, "Shop deleted successfully"));
});
exports.getShopByVat = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { vatNumber } = req.params;
    const shop = await shopModel_1.Shop.findOne({ vat: vatNumber }).populate("createdBy", "firstName lastName email");
    if (!shop) {
        throw new apiHandlerHelpers_2.ApiError(404, "Shop not found");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, shop, "Shop retrieved successfully"));
});
exports.getShopsByPincode = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { pincode } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    if (!/^[0-9]{6}$/.test(pincode)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid pincode format");
    }
    const total = await shopModel_1.Shop.countDocuments({
        address: { $regex: pincode, $options: "i" },
    });
    const shops = await shopModel_1.Shop.find({
        address: { $regex: pincode, $options: "i" },
    })
        .skip(skip)
        .limit(limit)
        .sort({ shopName: 1 })
        .populate("createdBy", "firstName lastName email");
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        shops,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Shops retrieved successfully"));
});
// Additional helper methods if needed
const deleteShopAttachments = async (attachments) => {
    if (!attachments || attachments.length === 0)
        return;
    await Promise.all(attachments.map(async (attachment) => {
        try {
            const key = (0, uploadConf_1.getS3KeyFromUrl)(attachment.filePath);
            await (0, uploadConf_1.deleteFileFromS3)(key);
        }
        catch (error) {
            console.error(`Failed to delete file from S3: ${attachment.filePath}`, error);
        }
    }));
};
//# sourceMappingURL=shopController.js.map