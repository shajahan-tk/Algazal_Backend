"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportBillsToExcel = exports.getBillStatistics = exports.getFinancialSummary = exports.deleteBill = exports.updateBill = exports.getBill = exports.getBills = exports.createBill = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const billModel_1 = require("../models/billModel");
const shopModel_1 = require("../models/shopModel");
const vehicleModel_1 = require("../models/vehicleModel");
const categoryModel_1 = require("../models/categoryModel");
const uploadConf_1 = require("../utils/uploadConf");
const exceljs_1 = __importDefault(require("exceljs"));
exports.createBill = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { billType, billDate, paymentMethod, amount, 
    // General fields
    category, shop, invoiceNo, remarks, 
    // Fuel fields
    description, vehicle, kilometer, liter, 
    // Vehicle fields
    purpose, vehicles, 
    // Accommodation fields
    roomNo, note, } = req.body;
    // Validate required fields
    if (!billType || !billDate || !paymentMethod || !amount) {
        throw new apiHandlerHelpers_2.ApiError(400, "Required fields are missing");
    }
    // Validate bill type specific fields
    switch (billType) {
        case "general":
            if (!category || !shop) {
                throw new apiHandlerHelpers_2.ApiError(400, "Category and shop are required for general bills");
            }
            break;
        case "fuel":
            if (!description ||
                !vehicle ||
                kilometer === undefined ||
                liter === undefined) {
                throw new apiHandlerHelpers_2.ApiError(400, "Description, vehicle, kilometer and liter are required for fuel bills");
            }
            break;
        case "mess":
            if (!shop) {
                throw new apiHandlerHelpers_2.ApiError(400, "Shop is required for mess bills");
            }
            break;
        case "vehicle":
            if (!purpose || !vehicles || !shop) {
                throw new apiHandlerHelpers_2.ApiError(400, "Purpose, vehicles and shop are required for vehicle bills");
            }
            break;
        case "accommodation":
            if (!shop || !roomNo) {
                throw new apiHandlerHelpers_2.ApiError(400, "Shop and roomNo are required for accommodation bills");
            }
            break;
        case "commission":
            // No additional fields required for commission bills
            break;
        default:
            throw new apiHandlerHelpers_2.ApiError(400, "Invalid bill type");
    }
    // Check references
    if (shop) {
        const shopExists = await shopModel_1.Shop.findById(shop);
        if (!shopExists) {
            throw new apiHandlerHelpers_2.ApiError(404, "Shop not found");
        }
    }
    if (category) {
        const categoryExists = await categoryModel_1.Category.findById(category);
        if (!categoryExists) {
            throw new apiHandlerHelpers_2.ApiError(404, "Category not found");
        }
    }
    if (vehicle) {
        const vehicleExists = await vehicleModel_1.Vehicle.findById(vehicle);
        if (!vehicleExists) {
            throw new apiHandlerHelpers_2.ApiError(404, "Vehicle not found");
        }
    }
    if (vehicles && vehicles.length > 0) {
        const vehiclesExist = await vehicleModel_1.Vehicle.find({ _id: { $in: vehicles } });
        if (vehiclesExist.length !== vehicles.length) {
            throw new apiHandlerHelpers_2.ApiError(404, "One or more vehicles not found");
        }
    }
    // Handle file uploads with proper typing
    let attachments = [];
    // Fix for req.files type issue
    const files = Array.isArray(req.files)
        ? req.files
        : req.files
            ? Object.values(req.files).flat()
            : [];
    if (files.length > 0) {
        const uploadResults = await (0, uploadConf_1.handleMultipleFileUploads)(files);
        if (!uploadResults.success) {
            throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload bill attachments");
        }
        attachments =
            uploadResults.uploadData?.map((file) => ({
                fileName: file.key.split("/").pop() || "attachment",
                fileType: file.mimetype,
                filePath: file.url,
            })) || [];
    }
    // Create the bill with proper typing
    const bill = await billModel_1.Bill.create({
        billType,
        billDate: new Date(billDate),
        paymentMethod,
        amount,
        attachments,
        createdBy: req.user?.userId,
        // General fields
        category,
        shop,
        invoiceNo,
        remarks,
        // Fuel fields
        description,
        vehicle,
        kilometer,
        liter,
        // Vehicle fields
        purpose,
        vehicles,
        // Accommodation fields
        roomNo,
        note,
    });
    res.status(201).json(new apiHandlerHelpers_1.ApiResponse(201, bill, "Bill created successfully"));
});
// Get all bills with filters
exports.getBills = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = {};
    // Bill type filter
    if (req.query.billType) {
        filter.billType = req.query.billType;
    }
    // Date range filter (takes precedence over year/month)
    if (req.query.startDate && req.query.endDate) {
        filter.billDate = {
            $gte: new Date(req.query.startDate),
            $lte: new Date(req.query.endDate),
        };
    }
    else {
        // Year filter
        if (req.query.year) {
            const year = parseInt(req.query.year);
            if (isNaN(year)) {
                throw new apiHandlerHelpers_2.ApiError(400, "Invalid year value");
            }
            filter.billDate = {
                $gte: new Date(year, 0, 1),
                $lte: new Date(year + 1, 0, 1),
            };
        }
        // Month filter (works with year filter)
        if (req.query.month) {
            const month = parseInt(req.query.month);
            if (isNaN(month) || month < 1 || month > 12) {
                throw new apiHandlerHelpers_2.ApiError(400, "Invalid month value (1-12)");
            }
            if (!filter.billDate) {
                // If no year specified, use current year
                const currentYear = new Date().getFullYear();
                filter.billDate = {
                    $gte: new Date(currentYear, month - 1, 1),
                    $lt: new Date(currentYear, month, 1),
                };
            }
            else {
                // Adjust existing year filter to specific month
                const startDate = new Date(filter.billDate.$gte);
                startDate.setMonth(month - 1);
                startDate.setDate(1);
                const endDate = new Date(startDate);
                endDate.setMonth(month);
                filter.billDate.$gte = startDate;
                filter.billDate.$lte = endDate;
            }
        }
    }
    // Shop filter
    if (req.query.shop) {
        filter.shop = req.query.shop;
    }
    // Category filter
    if (req.query.category) {
        filter.category = req.query.category;
    }
    if (req.query.paymentMethod) {
        filter.paymentMethod = req.query.paymentMethod;
    }
    // Vehicle filter
    if (req.query.vehicle) {
        filter.$or = [
            { vehicle: req.query.vehicle },
            { vehicles: req.query.vehicle },
        ];
    }
    // Amount range filter
    if (req.query.minAmount || req.query.maxAmount) {
        filter.amount = {};
        if (req.query.minAmount) {
            filter.amount.$gte = parseFloat(req.query.minAmount);
        }
        if (req.query.maxAmount) {
            filter.amount.$lte = parseFloat(req.query.maxAmount);
        }
    }
    // Search by invoice number or description
    if (req.query.search) {
        filter.$or = [
            { invoiceNo: { $regex: req.query.search, $options: "i" } },
            { description: { $regex: req.query.search, $options: "i" } },
            { purpose: { $regex: req.query.search, $options: "i" } },
        ];
    }
    const total = await billModel_1.Bill.countDocuments(filter);
    // Calculate total amount of all matching bills
    const totalAmountResult = await billModel_1.Bill.aggregate([
        { $match: filter },
        { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
    ]);
    const totalAmount = totalAmountResult[0]?.totalAmount || 0;
    const bills = await billModel_1.Bill.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ billDate: -1 })
        .populate("category", "name description")
        .populate("shop", "shopName shopNo")
        .populate("vehicle", "vehicleNumber make model")
        .populate("vehicles", "vehicleNumber make model")
        .populate("createdBy", "firstName lastName email");
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        bills,
        totalAmount,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Bills retrieved successfully"));
});
// Get a single bill by ID
exports.getBill = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const bill = await billModel_1.Bill.findById(id)
        .populate("category", "name description")
        .populate("shop", "shopName shopNo")
        .populate("vehicle", "vehicleNumber make model")
        .populate("vehicles", "vehicleNumber make model")
        .populate("createdBy", "firstName lastName email");
    if (!bill) {
        throw new apiHandlerHelpers_2.ApiError(404, "Bill not found");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, bill, "Bill retrieved successfully"));
});
exports.updateBill = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const bill = await billModel_1.Bill.findById(id);
    if (!bill) {
        throw new apiHandlerHelpers_2.ApiError(404, "Bill not found");
    }
    // Check references if being updated
    if (updateData.shop) {
        const shopExists = await shopModel_1.Shop.findById(updateData.shop);
        if (!shopExists) {
            throw new apiHandlerHelpers_2.ApiError(404, "Shop not found");
        }
    }
    if (updateData.category) {
        const categoryExists = await categoryModel_1.Category.findById(updateData.category);
        if (!categoryExists) {
            throw new apiHandlerHelpers_2.ApiError(404, "Category not found");
        }
    }
    if (updateData.vehicle) {
        const vehicleExists = await vehicleModel_1.Vehicle.findById(updateData.vehicle);
        if (!vehicleExists) {
            throw new apiHandlerHelpers_2.ApiError(404, "Vehicle not found");
        }
    }
    if (updateData.vehicles && updateData.vehicles.length > 0) {
        const vehiclesExist = await vehicleModel_1.Vehicle.find({
            _id: { $in: updateData.vehicles },
        });
        if (vehiclesExist.length !== updateData.vehicles.length) {
            throw new apiHandlerHelpers_2.ApiError(404, "One or more vehicles not found");
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
            throw new apiHandlerHelpers_2.ApiError(500, "Failed to upload new bill attachments");
        }
        newAttachments =
            uploadResults.uploadData?.map((file) => ({
                fileName: file.key.split("/").pop() || "attachment",
                fileType: file.mimetype,
                filePath: file.url,
            })) || [];
    }
    // Handle attachment deletions if specified
    if (updateData.deletedAttachments &&
        updateData.deletedAttachments.length > 0) {
        await Promise.all(updateData.deletedAttachments.map(async (attachmentId) => {
            const attachment = bill.attachments.id(attachmentId);
            if (attachment) {
                try {
                    const key = (0, uploadConf_1.getS3KeyFromUrl)(attachment.filePath);
                    await (0, uploadConf_1.deleteFileFromS3)(key);
                    bill.attachments.pull(attachmentId);
                }
                catch (error) {
                    console.error(`Failed to delete file from S3: ${attachment.filePath}`, error);
                }
            }
        }));
    }
    // Prepare update payload
    const updatePayload = {
        ...updateData,
        $push: { attachments: { $each: newAttachments } },
    };
    // Convert dates if they exist in updateData
    if (updateData.billDate) {
        updatePayload.billDate = new Date(updateData.billDate);
    }
    // Update the bill
    const updatedBill = await billModel_1.Bill.findByIdAndUpdate(id, updatePayload, {
        new: true,
    })
        .populate("category", "name description")
        .populate("shop", "shopName shopNo")
        .populate("vehicle", "vehicleNumber make model")
        .populate("vehicles", "vehicleNumber make model")
        .populate("createdBy", "firstName lastName email");
    if (!updatedBill) {
        throw new apiHandlerHelpers_2.ApiError(500, "Failed to update bill");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedBill, "Bill updated successfully"));
});
// Delete a bill
exports.deleteBill = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const bill = await billModel_1.Bill.findById(id);
    if (!bill) {
        throw new apiHandlerHelpers_2.ApiError(404, "Bill not found");
    }
    // Delete all associated files from S3
    if (bill.attachments && bill.attachments.length > 0) {
        await Promise.all(bill.attachments.map(async (attachment) => {
            try {
                const key = (0, uploadConf_1.getS3KeyFromUrl)(attachment.filePath);
                await (0, uploadConf_1.deleteFileFromS3)(key);
            }
            catch (error) {
                console.error(`Failed to delete file from S3: ${attachment.filePath}`, error);
            }
        }));
    }
    await billModel_1.Bill.findByIdAndDelete(id);
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, null, "Bill deleted successfully"));
});
// Get financial summary
exports.getFinancialSummary = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { startDate, endDate, groupBy } = req.query;
    const match = {};
    if (startDate && endDate) {
        match.billDate = {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
        };
    }
    let groupStage;
    switch (groupBy) {
        case "month":
            groupStage = {
                $group: {
                    _id: {
                        year: { $year: "$billDate" },
                        month: { $month: "$billDate" },
                        billType: "$billType",
                    },
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            };
            break;
        case "billType":
            groupStage = {
                $group: {
                    _id: "$billType",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            };
            break;
        case "category":
            groupStage = {
                $group: {
                    _id: "$category",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            };
            break;
        case "shop":
            groupStage = {
                $group: {
                    _id: "$shop",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            };
            break;
        default:
            groupStage = {
                $group: {
                    _id: null,
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            };
    }
    const pipeline = [{ $match: match }, groupStage];
    if (groupBy === "shop" || groupBy === "category") {
        const lookupCollection = groupBy === "shop" ? "shops" : "categories";
        const fieldName = groupBy === "shop" ? "shopDetails" : "categoryDetails";
        pipeline.push({
            $lookup: {
                from: lookupCollection,
                localField: "_id",
                foreignField: "_id",
                as: fieldName,
            },
        });
        pipeline.push({ $unwind: `$${fieldName}` });
        const projection = {
            _id: 1,
            totalAmount: 1,
            count: 1,
        };
        if (groupBy === "shop") {
            projection.shopName = `$${fieldName}.shopName`;
            projection.shopNo = `$${fieldName}.shopNo`;
        }
        else {
            projection.categoryName = `$${fieldName}.name`;
            projection.categoryDescription = `$${fieldName}.description`;
        }
        pipeline.push({ $project: projection });
    }
    pipeline.push({ $sort: { _id: 1 } });
    const summary = await billModel_1.Bill.aggregate(pipeline);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, summary, "Financial summary retrieved successfully"));
});
// Get bill statistics
exports.getBillStatistics = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { startDate, endDate } = req.query;
    const match = {};
    if (startDate && endDate) {
        match.billDate = {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
        };
    }
    const stats = await billModel_1.Bill.aggregate([
        { $match: match },
        {
            $facet: {
                totalAmount: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
                byType: [
                    { $group: { _id: "$billType", total: { $sum: "$amount" } } },
                ],
                byMonth: [
                    {
                        $group: {
                            _id: {
                                year: { $year: "$billDate" },
                                month: { $month: "$billDate" },
                            },
                            total: { $sum: "$amount" },
                        },
                    },
                    { $sort: { "_id.year": 1, "_id.month": 1 } },
                ],
                topCategories: [
                    {
                        $group: {
                            _id: "$category",
                            total: { $sum: "$amount" },
                            count: { $sum: 1 },
                        },
                    },
                    { $sort: { total: -1 } },
                    { $limit: 5 },
                    {
                        $lookup: {
                            from: "categories",
                            localField: "_id",
                            foreignField: "_id",
                            as: "categoryDetails",
                        },
                    },
                    { $unwind: "$categoryDetails" },
                    {
                        $project: {
                            _id: 1,
                            total: 1,
                            count: 1,
                            categoryName: "$categoryDetails.name",
                            categoryDescription: "$categoryDetails.description",
                        },
                    },
                ],
                topShops: [
                    {
                        $group: {
                            _id: "$shop",
                            total: { $sum: "$amount" },
                            count: { $sum: 1 },
                        },
                    },
                    { $sort: { total: -1 } },
                    { $limit: 5 },
                    {
                        $lookup: {
                            from: "shops",
                            localField: "_id",
                            foreignField: "_id",
                            as: "shopDetails",
                        },
                    },
                    { $unwind: "$shopDetails" },
                    {
                        $project: {
                            _id: 1,
                            total: 1,
                            count: 1,
                            shopName: "$shopDetails.shopName",
                            shopNo: "$shopDetails.shopNo",
                        },
                    },
                ],
            },
        },
    ]);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, stats[0], "Bill statistics retrieved successfully"));
});
exports.exportBillsToExcel = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const filter = {};
    // Bill type filter
    if (req.query.billType) {
        filter.billType = req.query.billType;
    }
    // Date range filter
    if (req.query.startDate && req.query.endDate) {
        filter.billDate = {
            $gte: new Date(req.query.startDate),
            $lte: new Date(req.query.endDate),
        };
    }
    // Shop filter
    if (req.query.shop) {
        filter.shop = req.query.shop;
    }
    // Category filter
    if (req.query.category) {
        filter.category = req.query.category;
    }
    // Payment method filter
    if (req.query.paymentMethod) {
        filter.paymentMethod = req.query.paymentMethod;
    }
    // Vehicle filter
    if (req.query.vehicle) {
        filter.$or = [
            { vehicle: req.query.vehicle },
            { vehicles: req.query.vehicle },
        ];
    }
    // Amount range filter
    if (req.query.minAmount || req.query.maxAmount) {
        filter.amount = {};
        if (req.query.minAmount) {
            filter.amount.$gte = parseFloat(req.query.minAmount);
        }
        if (req.query.maxAmount) {
            filter.amount.$lte = parseFloat(req.query.maxAmount);
        }
    }
    // Search filter
    if (req.query.search) {
        filter.$or = [
            { invoiceNo: { $regex: req.query.search, $options: "i" } },
            { description: { $regex: req.query.search, $options: "i" } },
            { purpose: { $regex: req.query.search, $options: "i" } },
        ];
    }
    // Get all bills matching the filter with proper typing for populated fields
    const bills = await billModel_1.Bill.find(filter)
        .sort({ billDate: -1 })
        .populate([
        { path: 'category', select: 'name' },
        { path: 'shop', select: 'shopName shopNo' },
        { path: 'vehicle', select: 'vehicleNumber' },
        { path: 'vehicles', select: 'vehicleNumber' },
        { path: 'createdBy', select: 'firstName lastName' }
    ]);
    // Create a new workbook
    const workbook = new exceljs_1.default.Workbook();
    const worksheet = workbook.addWorksheet("Bills");
    // Define columns for each bill type
    const billTypeColumns = {
        general: [
            { header: "SNO", key: "sno", width: 5 },
            { header: "DATE", key: "billDate", width: 12, style: { numFmt: "dd-mm-yyyy" } },
            { header: "CATEGORY", key: "category", width: 20 },
            { header: "SHOP NAME", key: "shopName", width: 25 },
            { header: "SHOP NUMBER", key: "shopNo", width: 15 },
            { header: "INVOICE NO", key: "invoiceNo", width: 15 },
            { header: "PAYMENT METHOD", key: "paymentMethod", width: 15 },
            { header: "AMOUNT", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
            { header: "REMARKS", key: "remarks", width: 30 }
        ],
        mess: [
            { header: "SNO", key: "sno", width: 5 },
            { header: "DATE", key: "billDate", width: 12, style: { numFmt: "dd-mm-yyyy" } },
            { header: "SHOP NAME", key: "shopName", width: 25 },
            { header: "SHOP NUMBER", key: "shopNo", width: 15 },
            { header: "INVOICE NO", key: "invoiceNo", width: 15 },
            { header: "PAYMENT METHOD", key: "paymentMethod", width: 15 },
            { header: "AMOUNT", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
            { header: "REMARKS", key: "remarks", width: 30 }
        ],
        accommodation: [
            { header: "SNO", key: "sno", width: 5 },
            { header: "DATE", key: "billDate", width: 12, style: { numFmt: "dd-mm-yyyy" } },
            { header: "CATEGORY", key: "category", width: 20 },
            { header: "COMPANY NAME", key: "shopName", width: 25 },
            { header: "ROOM NO", key: "roomNo", width: 10 },
            { header: "INVOICE NO", key: "invoiceNo", width: 15 },
            { header: "PAYMENT METHOD", key: "paymentMethod", width: 15 },
            { header: "AMOUNT", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
            { header: "NOTE", key: "note", width: 30 },
            { header: "REMARKS", key: "remarks", width: 30 }
        ],
        fuel: [
            { header: "SNO", key: "sno", width: 5 },
            { header: "DATE", key: "billDate", width: 12, style: { numFmt: "dd-mm-yyyy" } },
            { header: "DESCRIPTION", key: "description", width: 30 },
            { header: "VEHICLE NO", key: "vehicle", width: 15 },
            { header: "PAYMENT METHOD", key: "paymentMethod", width: 15 },
            { header: "AMOUNT", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
            { header: "KILO METERS", key: "kilometer", width: 10 },
            { header: "LITER", key: "liter", width: 10 },
            { header: "REMARKS", key: "remarks", width: 30 }
        ],
        vehicle: [
            { header: "SNO", key: "sno", width: 5 },
            { header: "DATE", key: "billDate", width: 12, style: { numFmt: "dd-mm-yyyy" } },
            { header: "PURPOSE OF USE", key: "purpose", width: 20 },
            { header: "VEHICLE NO", key: "vehicles", width: 20 },
            { header: "INVOICE NO", key: "invoiceNo", width: 15 },
            { header: "PAYMENT METHOD", key: "paymentMethod", width: 15 },
            { header: "AMOUNT", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
            { header: "SHOP NAME", key: "shopName", width: 25 },
            { header: "LITER", key: "liter", width: 10 },
            { header: "REMARKS", key: "remarks", width: 30 }
        ],
        commission: [
            { header: "SNO", key: "sno", width: 5 },
            { header: "DATE", key: "billDate", width: 12, style: { numFmt: "dd-mm-yyyy" } },
            { header: "AMOUNT", key: "amount", width: 12, style: { numFmt: "#,##0.00" } }
        ]
    };
    // Determine which columns to use based on bill type filter
    let columns = [];
    if (req.query.billType && typeof req.query.billType === "string") {
        const billType = req.query.billType;
        columns = billTypeColumns[billType];
    }
    else {
        // If no bill type specified, use all possible columns (with unique keys)
        const allColumns = Object.values(billTypeColumns).flat();
        const uniqueColumns = allColumns.filter((col, index, self) => index === self.findIndex((c) => c.key === col.key));
        columns = uniqueColumns;
    }
    // Set the worksheet columns
    worksheet.columns = columns;
    // Add data rows with proper typing for populated fields
    bills.forEach((bill, index) => {
        const rowData = {
            sno: index + 1,
            billDate: bill.billDate,
            amount: bill.amount,
            paymentMethod: bill.paymentMethod,
            remarks: bill.remarks || "",
        };
        // Common fields
        if (bill.shop && typeof bill.shop === 'object') {
            rowData.shopName = bill.shop.shopName;
            rowData.shopNo = bill.shop.shopNo;
        }
        // Type-specific fields
        switch (bill.billType) {
            case "general":
                rowData.category = bill.category && typeof bill.category === 'object'
                    ? bill.category.name
                    : "";
                rowData.invoiceNo = bill.invoiceNo || "";
                break;
            case "mess":
                rowData.invoiceNo = bill.invoiceNo || "";
                break;
            case "accommodation":
                rowData.category = bill.category && typeof bill.category === 'object'
                    ? bill.category.name
                    : "";
                rowData.roomNo = bill.roomNo || "";
                rowData.note = bill.note || "";
                rowData.invoiceNo = bill.invoiceNo || "";
                break;
            case "fuel":
                rowData.description = bill.description || "";
                rowData.vehicle = bill.vehicle && typeof bill.vehicle === 'object'
                    ? bill.vehicle.vehicleNumber
                    : "";
                rowData.kilometer = bill.kilometer || "";
                rowData.liter = bill.liter || "";
                break;
            case "vehicle":
                rowData.purpose = bill.purpose || "";
                rowData.vehicles = bill.vehicles && Array.isArray(bill.vehicles)
                    ? bill.vehicles.map(v => typeof v === 'object' ? v.vehicleNumber : "").join(", ")
                    : "";
                rowData.invoiceNo = bill.invoiceNo || "";
                rowData.liter = bill.liter || "";
                break;
            case "commission":
                // Only basic fields needed
                break;
        }
        worksheet.addRow(rowData);
    });
    // Style the header row
    worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFD3D3D3" },
        };
        cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
        };
    });
    // Freeze the header row
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    // Set response headers for Excel file download
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=bills_export_${new Date().toISOString().split("T")[0]}.xlsx`);
    // Write the workbook to the response
    await workbook.xlsx.write(res);
    res.end();
});
//# sourceMappingURL=billController.js.map