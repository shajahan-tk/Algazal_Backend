
import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Bill, BillType } from "../models/billModel";
import { Shop } from "../models/shopModel";
import { Vehicle } from "../models/vehicleModel";
import { Category } from "../models/categoryModel";
import {
  handleMultipleFileUploads,
  deleteFileFromS3,
  getS3KeyFromUrl,
} from "../utils/uploadConf";
import ExcelJS from "exceljs";


export const createBill = asyncHandler(async (req: Request, res: Response) => {
  const {
    billType,
    billDate,
    paymentMethod,
    amount,
    // General fields
    category,
    shop,
    invoiceNo,
    remarks,
    // Fuel fields
    description,
    vehicle, // For single vehicle (backward compatibility)
    vehicles, // For multiple vehicles in fuel bills
    kilometer,
    liter,
    // Vehicle fields
    purpose,
    // vehicles is used for vehicle bills too
    // Accommodation fields
    roomNo,
    note,
  } = req.body;

  // Validate required fields
  if (!billType || !billDate || !paymentMethod || !amount) {
    throw new ApiError(400, "Required fields are missing");
  }

  // Validate bill type specific fields
  switch (billType) {
    case "general":
      if (!category || !shop) {
        throw new ApiError(
          400,
          "Category and shop are required for general bills"
        );
      }
      break;
    case "fuel":
      if (
        !description ||
        (!vehicle && (!vehicles || vehicles.length === 0)) ||
        kilometer === undefined ||
        liter === undefined
      ) {
        throw new ApiError(
          400,
          "Description, vehicle(s), kilometer and liter are required for fuel bills"
        );
      }
      break;
    case "mess":
      if (!shop) {
        throw new ApiError(400, "Shop is required for mess bills");
      }
      break;
    case "vehicle":
      if (!purpose || !vehicles || !shop) {
        throw new ApiError(
          400,
          "Purpose, vehicles and shop are required for vehicle bills"
        );
      }
      break;
    case "accommodation":
      if (!shop || !roomNo) {
        throw new ApiError(
          400,
          "Shop and roomNo are required for accommodation bills"
        );
      }
      break;
    case "commission":
      // Commission bills can have remarks but no additional required fields
      break;
    default:
      throw new ApiError(400, "Invalid bill type");
  }

  // Check references
  if (shop) {
    const shopExists = await Shop.findById(shop);
    if (!shopExists) {
      throw new ApiError(404, "Shop not found");
    }
  }

  if (category) {
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      throw new ApiError(404, "Category not found");
    }
  }

  // Handle vehicle validation for fuel bills (can have multiple vehicles)
  if (billType === "fuel") {
    let vehicleIds = [];
    if (vehicles && Array.isArray(vehicles)) {
      vehicleIds = vehicles;
    } else if (vehicle) {
      vehicleIds = [vehicle];
    }

    if (vehicleIds.length > 0) {
      const vehiclesExist = await Vehicle.find({ _id: { $in: vehicleIds } });
      if (vehiclesExist.length !== vehicleIds.length) {
        throw new ApiError(404, "One or more vehicles not found");
      }
    }
  }

  // Handle single vehicle validation for other bill types
  if (vehicle && billType !== "fuel") {
    const vehicleExists = await Vehicle.findById(vehicle);
    if (!vehicleExists) {
      throw new ApiError(404, "Vehicle not found");
    }
  }

  // Handle multiple vehicles validation for vehicle bills
  if (vehicles && vehicles.length > 0 && billType === "vehicle") {
    const vehiclesExist = await Vehicle.find({ _id: { $in: vehicles } });
    if (vehiclesExist.length !== vehicles.length) {
      throw new ApiError(404, "One or more vehicles not found");
    }
  }

  // Handle file uploads with proper typing
  let attachments: Array<{
    fileName: string;
    fileType: string;
    filePath: string;
  }> = [];

  // Fix for req.files type issue
  const files = Array.isArray(req.files)
    ? req.files
    : req.files
      ? Object.values(req.files).flat()
      : [];

  if (files.length > 0) {
    const uploadResults = await handleMultipleFileUploads(files);
    if (!uploadResults.success) {
      throw new ApiError(500, "Failed to upload bill attachments");
    }
    attachments =
      uploadResults.uploadData?.map((file) => ({
        fileName: file.key.split("/").pop() || "attachment",
        fileType: file.mimetype,
        filePath: file.url,
      })) || [];
  }

  // Prepare bill data
  const billData: any = {
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
    remarks, // Now available for all bill types including commission
    // Fuel fields
    description,
    kilometer,
    liter,
    // Vehicle fields
    purpose,
    // Accommodation fields
    roomNo,
    note,
  };

  // Handle vehicle assignment based on bill type
  if (billType === "fuel") {
    // For fuel bills, use vehicles array to support multiple vehicles
    if (vehicles && Array.isArray(vehicles)) {
      billData.vehicles = vehicles;
    } else if (vehicle) {
      billData.vehicles = [vehicle];
    }
  } else if (billType === "vehicle") {
    // For vehicle bills, use vehicles array
    billData.vehicles = vehicles;
  } else {
    // For other bill types, use single vehicle field
    billData.vehicle = vehicle;
  }

  // Create the bill with proper typing
  const bill = await Bill.create(billData);

  res.status(201).json(new ApiResponse(201, bill, "Bill created successfully"));
});

// Get all bills with filters
export const getBills = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Build base match conditions
  const matchConditions: any = {};

  // Bill type filter
  if (req.query.billType) {
    matchConditions.billType = req.query.billType;
  }

  // Date range filter (takes precedence over year/month)
  if (req.query.startDate && req.query.endDate) {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    endDate.setHours(23, 59, 59, 999); // Include the entire end date
    
    matchConditions.billDate = {
      $gte: startDate,
      $lte: endDate,
    };
  } else {
    // Year filter
    if (req.query.year) {
      const year = parseInt(req.query.year as string);
      if (isNaN(year)) {
        throw new ApiError(400, "Invalid year value");
      }
      matchConditions.billDate = {
        $gte: new Date(year, 0, 1), // Jan 1 of the year
        $lt: new Date(year + 1, 0, 1), // Jan 1 of next year
      };
    }

    // Month filter
    if (req.query.month) {
      const month = parseInt(req.query.month as string);
      if (isNaN(month) || month < 1 || month > 12) {
        throw new ApiError(400, "Invalid month value (1-12)");
      }

      // Determine the year to use
      let year: number;
      if (req.query.year) {
        year = parseInt(req.query.year as string);
      } else {
        year = new Date().getFullYear();
      }

      // Create proper date range for the month
      const startDate = new Date(year, month - 1, 1); // First day of month
      const endDate = new Date(year, month, 0); // Last day of month
      endDate.setHours(23, 59, 59, 999); // Include entire last day

      if (!matchConditions.billDate) {
        // If no date filter exists, create new one
        matchConditions.billDate = {
          $gte: startDate,
          $lte: endDate,
        };
      } else {
        // If year filter exists, combine with month
        const yearStart = new Date(matchConditions.billDate.$gte);
        const yearEnd = new Date(matchConditions.billDate.$lt);
        
        // Set the specific month within the year range
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0);
        monthEnd.setHours(23, 59, 59, 999);

        // Ensure the month is within the selected year
        if (monthStart >= yearStart && monthEnd < yearEnd) {
          matchConditions.billDate = {
            $gte: monthStart,
            $lte: monthEnd,
          };
        } else {
          // If month is outside year range, return empty results
          matchConditions.billDate = {
            $gte: new Date(3000, 0, 1), // Far future date
            $lt: new Date(3000, 0, 1),   // Same date = no results
          };
        }
      }
    }
  }

  // Other filters
  if (req.query.shop) matchConditions.shop = req.query.shop;
  if (req.query.category) matchConditions.category = req.query.category;
  if (req.query.paymentMethod) matchConditions.paymentMethod = req.query.paymentMethod;
  
  if (req.query.vehicle) {
    matchConditions.$or = [
      { vehicle: req.query.vehicle },
      { vehicles: req.query.vehicle },
    ];
  }

  // Amount range filter
  if (req.query.minAmount || req.query.maxAmount) {
    const amountFilter: any = {};
    if (req.query.minAmount) {
      amountFilter.$gte = parseFloat(req.query.minAmount as string);
    }
    if (req.query.maxAmount) {
      amountFilter.$lte = parseFloat(req.query.maxAmount as string);
    }
    matchConditions.amount = amountFilter;
  }

  // Build aggregation pipeline
  const pipeline: any[] = [];

  // Add match conditions first for better performance
  if (Object.keys(matchConditions).length > 0) {
    pipeline.push({ $match: matchConditions });
  }

  // Lookup related collections
  pipeline.push(
    {
      $lookup: {
        from: "shops",
        localField: "shop",
        foreignField: "_id",
        as: "shopData",
      },
    },
    {
      $lookup: {
        from: "vehicles",
        localField: "vehicle",
        foreignField: "_id",
        as: "vehicleData",
      },
    },
    {
      $lookup: {
        from: "vehicles",
        localField: "vehicles",
        foreignField: "_id",
        as: "vehiclesData",
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        as: "categoryData",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "createdByData",
      },
    }
  );

  // Add search filter if provided
  if (req.query.search) {
    const searchTerm = req.query.search as string;
    const searchRegex = { $regex: searchTerm, $options: "i" };

    pipeline.push({
      $match: {
        $or: [
          // Bill fields
          { invoiceNo: searchRegex },
          { description: searchRegex },
          { purpose: searchRegex },
          { remarks: searchRegex },
          { roomNo: searchRegex },
          { note: searchRegex },
          // Shop fields
          { "shopData.shopName": searchRegex },
          { "shopData.shopNo": searchRegex },
          { "shopData.ownerName": searchRegex },
          // Vehicle fields
          { "vehicleData.vehicleNumber": searchRegex },
          { "vehicleData.make": searchRegex },
          { "vehicleData.vechicleModel": searchRegex },
          { "vehiclesData.vehicleNumber": searchRegex },
          { "vehiclesData.make": searchRegex },
          { "vehiclesData.vechicleModel": searchRegex },
          // Category fields
          { "categoryData.name": searchRegex },
          { "categoryData.description": searchRegex },
        ],
      },
    });
  }

  // Add facet stage for pagination and total count
  pipeline.push({
    $facet: {
      data: [
        { $sort: { billDate: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            billType: 1,
            billDate: 1,
            paymentMethod: 1,
            amount: 1,
            attachments: 1,
            invoiceNo: 1,
            description: 1,
            purpose: 1,
            remarks: 1,
            roomNo: 1,
            note: 1,
            kilometer: 1,
            liter: 1,
            createdAt: 1,
            updatedAt: 1,
            category: {
              $arrayElemAt: [
                {
                  $map: {
                    input: "$categoryData",
                    as: "cat",
                    in: {
                      _id: "$$cat._id",
                      name: "$$cat.name",
                      description: "$$cat.description",
                    },
                  },
                },
                0,
              ],
            },
            shop: {
              $arrayElemAt: [
                {
                  $map: {
                    input: "$shopData",
                    as: "shop",
                    in: {
                      _id: "$$shop._id",
                      shopName: "$$shop.shopName",
                      shopNo: "$$shop.shopNo",
                      ownerName: "$$shop.ownerName",
                    },
                  },
                },
                0,
              ],
            },
            vehicle: {
              $arrayElemAt: [
                {
                  $map: {
                    input: "$vehicleData",
                    as: "vehicle",
                    in: {
                      _id: "$$vehicle._id",
                      vehicleNumber: "$$vehicle.vehicleNumber",
                      make: "$$vehicle.make",
                      vechicleModel: "$$vehicle.vechicleModel",
                    },
                  },
                },
                0,
              ],
            },
            vehicles: {
              $map: {
                input: "$vehiclesData",
                as: "vehicle",
                in: {
                  _id: "$$vehicle._id",
                  vehicleNumber: "$$vehicle.vehicleNumber",
                  make: "$$vehicle.make",
                  vechicleModel: "$$vehicle.vechicleModel",
                },
              },
            },
            createdBy: {
              $arrayElemAt: [
                {
                  $map: {
                    input: "$createdByData",
                    as: "user",
                    in: {
                      _id: "$$user._id",
                      firstName: "$$user.firstName",
                      lastName: "$$user.lastName",
                      email: "$$user.email",
                    },
                  },
                },
                0,
              ],
            },
          },
        },
      ],
      totalCount: [{ $count: "count" }],
      totalAmount: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
    },
  });

  const result = await Bill.aggregate(pipeline);
  
  const bills = result[0].data;
  const total = result[0].totalCount[0]?.count || 0;
  const totalAmount = result[0].totalAmount[0]?.total || 0;

  res.status(200).json(
    new ApiResponse(
      200,
      {
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
      },
      "Bills retrieved successfully"
    )
  );
});
// Get a single bill by ID
export const getBill = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const bill = await Bill.findById(id)
    .populate("category", "name description")
    .populate("shop", "shopName shopNo")
    .populate("vehicle", "vehicleNumber make model")
    .populate("vehicles", "vehicleNumber make model")
    .populate("createdBy", "firstName lastName email");

  if (!bill) {
    throw new ApiError(404, "Bill not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, bill, "Bill retrieved successfully"));
});

export const updateBill = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const updateData = req.body;

  const bill = await Bill.findById(id);
  if (!bill) {
    throw new ApiError(404, "Bill not found");
  }

  // Check references if being updated
  if (updateData.shop) {
    const shopExists = await Shop.findById(updateData.shop);
    if (!shopExists) {
      throw new ApiError(404, "Shop not found");
    }
  }

  if (updateData.category) {
    const categoryExists = await Category.findById(updateData.category);
    if (!categoryExists) {
      throw new ApiError(404, "Category not found");
    }
  }

  // Handle vehicle validation based on bill type
  if (bill.billType === "fuel") {
    // For fuel bills, check vehicles array
    if (updateData.vehicles && updateData.vehicles.length > 0) {
      const vehiclesExist = await Vehicle.find({
        _id: { $in: updateData.vehicles },
      });
      if (vehiclesExist.length !== updateData.vehicles.length) {
        throw new ApiError(404, "One or more vehicles not found");
      }
    } else if (updateData.vehicle) {
      // Handle single vehicle for backward compatibility
      const vehicleExists = await Vehicle.findById(updateData.vehicle);
      if (!vehicleExists) {
        throw new ApiError(404, "Vehicle not found");
      }
      // Convert single vehicle to vehicles array
      updateData.vehicles = [updateData.vehicle];
      delete updateData.vehicle;
    }
  } else {
    // For other bill types
    if (updateData.vehicle) {
      const vehicleExists = await Vehicle.findById(updateData.vehicle);
      if (!vehicleExists) {
        throw new ApiError(404, "Vehicle not found");
      }
    }

    if (updateData.vehicles && updateData.vehicles.length > 0) {
      const vehiclesExist = await Vehicle.find({
        _id: { $in: updateData.vehicles },
      });
      if (vehiclesExist.length !== updateData.vehicles.length) {
        throw new ApiError(404, "One or more vehicles not found");
      }
    }
  }

  // Handle file uploads for new attachments
  let newAttachments: Array<{
    fileName: string;
    fileType: string;
    filePath: string;
  }> = [];

  // Fix for req.files type issue
  const files = Array.isArray(req.files)
    ? req.files
    : req.files
      ? Object.values(req.files).flat()
      : [];

  if (files.length > 0) {
    const uploadResults = await handleMultipleFileUploads(files);
    if (!uploadResults.success) {
      throw new ApiError(500, "Failed to upload new bill attachments");
    }
    newAttachments =
      uploadResults.uploadData?.map((file) => ({
        fileName: file.key.split("/").pop() || "attachment",
        fileType: file.mimetype,
        filePath: file.url,
      })) || [];
  }

  // Handle attachment deletions if specified
  if (
    updateData.deletedAttachments &&
    updateData.deletedAttachments.length > 0
  ) {
    await Promise.all(
      updateData.deletedAttachments.map(async (attachmentId: string) => {
        const attachment = bill.attachments.id(attachmentId);
        if (attachment) {
          try {
            const key = getS3KeyFromUrl(attachment.filePath);
            await deleteFileFromS3(key);
            bill.attachments.pull(attachmentId);
          } catch (error) {
            console.error(
              `Failed to delete file from S3: ${attachment.filePath}`,
              error
            );
          }
        }
      })
    );
  }

  // Prepare update payload
  const updatePayload: any = {
    ...updateData,
    $push: { attachments: { $each: newAttachments } },
  };

  // Convert dates if they exist in updateData
  if (updateData.billDate) {
    updatePayload.billDate = new Date(updateData.billDate);
  }

  // Update the bill
  const updatedBill = await Bill.findByIdAndUpdate(id, updatePayload, {
    new: true,
  })
    .populate("category", "name description")
    .populate("shop", "shopName shopNo")
    .populate("vehicle", "vehicleNumber make model")
    .populate("vehicles", "vehicleNumber make model")
    .populate("createdBy", "firstName lastName email");

  if (!updatedBill) {
    throw new ApiError(500, "Failed to update bill");
  }

  res
    .status(200)
    .json(new ApiResponse(200, updatedBill, "Bill updated successfully"));
});

// Delete a bill
export const deleteBill = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const bill = await Bill.findById(id);
  if (!bill) {
    throw new ApiError(404, "Bill not found");
  }

  // Delete all associated files from S3
  if (bill.attachments && bill.attachments.length > 0) {
    await Promise.all(
      bill.attachments.map(async (attachment) => {
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

  await Bill.findByIdAndDelete(id);

  res.status(200).json(new ApiResponse(200, null, "Bill deleted successfully"));
});

// Get financial summary
export const getFinancialSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const { startDate, endDate, groupBy } = req.query;

    const match: any = {};
    if (startDate && endDate) {
      match.billDate = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    }

    let groupStage: any;
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

    const pipeline: any[] = [{ $match: match }, groupStage];

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

      const projection: any = {
        _id: 1,
        totalAmount: 1,
        count: 1,
      };

      if (groupBy === "shop") {
        projection.shopName = `$${fieldName}.shopName`;
        projection.shopNo = `$${fieldName}.shopNo`;
      } else {
        projection.categoryName = `$${fieldName}.name`;
        projection.categoryDescription = `$${fieldName}.description`;
      }

      pipeline.push({ $project: projection });
    }

    pipeline.push({ $sort: { _id: 1 } });

    const summary = await Bill.aggregate(pipeline);

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          summary,
          "Financial summary retrieved successfully"
        )
      );
  }
);

// Get bill statistics
export const getBillStatistics = asyncHandler(
  async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;

    const match: any = {};
    if (startDate && endDate) {
      match.billDate = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    }

    const stats = await Bill.aggregate([
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
      .json(
        new ApiResponse(200, stats[0], "Bill statistics retrieved successfully")
      );
  }
);

export const exportBillsToExcel = asyncHandler(
  async (req: Request, res: Response) => {
    const filter: any = {};

    // Bill type filter
    if (req.query.billType) {
      filter.billType = req.query.billType;
    }

    // Date range filter - Handle both date range and month/year
    if (req.query.startDate && req.query.endDate) {
      // Handle startDate and endDate parameters
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      // Set start date to beginning of day (00:00:00.000)
      startDate.setHours(0, 0, 0, 0);
      
      // Set end date to end of day (23:59:59.999)
      endDate.setHours(23, 59, 59, 999);
      
      console.log('Date Range Filter Applied:');
      console.log('Start Date:', startDate);
      console.log('End Date:', endDate);
      
      filter.billDate = {
        $gte: startDate,
        $lte: endDate,
      };
    } else if (req.query.month && req.query.year) {
      // Handle month and year parameters (this is what your frontend sends)
      const month = parseInt(req.query.month as string) - 1; // JavaScript months are 0-indexed
      const year = parseInt(req.query.year as string);
      
      const startOfMonth = new Date(year, month, 1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const endOfMonth = new Date(year, month + 1, 0); // Last day of the month
      endOfMonth.setHours(23, 59, 59, 999);
      
      console.log('Month/Year Filter Applied:');
      console.log('Month:', req.query.month, 'Year:', req.query.year);
      console.log('Start of Month:', startOfMonth);
      console.log('End of Month:', endOfMonth);
      
      filter.billDate = {
        $gte: startOfMonth,
        $lte: endOfMonth,
      };
    } else if (req.query.year && !req.query.month) {
      // Handle year only filter
      const year = parseInt(req.query.year as string);
      
      const startOfYear = new Date(year, 0, 1);
      startOfYear.setHours(0, 0, 0, 0);
      
      const endOfYear = new Date(year, 11, 31);
      endOfYear.setHours(23, 59, 59, 999);
      
      console.log('Year Filter Applied:');
      console.log('Year:', req.query.year);
      console.log('Start of Year:', startOfYear);
      console.log('End of Year:', endOfYear);
      
      filter.billDate = {
        $gte: startOfYear,
        $lte: endOfYear,
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
        filter.amount.$gte = parseFloat(req.query.minAmount as string);
      }
      if (req.query.maxAmount) {
        filter.amount.$lte = parseFloat(req.query.maxAmount as string);
      }
    }

    // Search filter - Handle conflict with vehicle filter
    if (req.query.search) {
      const searchFilters = [
        { invoiceNo: { $regex: req.query.search, $options: "i" } },
        { description: { $regex: req.query.search, $options: "i" } },
        { purpose: { $regex: req.query.search, $options: "i" } },
        { remarks: { $regex: req.query.search, $options: "i" } },
      ];
      
      // If vehicle filter already exists with $or, merge them
      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or }, // existing vehicle filter
          { $or: searchFilters } // search filter
        ];
        delete filter.$or; // remove the original $or to avoid conflict
      } else {
        filter.$or = searchFilters;
      }
    }

    // Debug: Log the final filter
    console.log('Final MongoDB Filter:', JSON.stringify(filter, null, 2));

    // Get all bills matching the filter with proper typing for populated fields
    const bills = await Bill.find(filter)
      .sort({ billDate: -1 })
      .populate<{
        category: { name: string } | null,
        shop: { shopName: string, shopNo: string } | null,
        vehicle: { vehicleNumber: string } | null,
        vehicles: { vehicleNumber: string }[],
        createdBy: { firstName: string, lastName: string } | null
      }>([
        { path: 'category', select: 'name' },
        { path: 'shop', select: 'shopName shopNo' },
        { path: 'vehicle', select: 'vehicleNumber' },
        { path: 'vehicles', select: 'vehicleNumber' },
        { path: 'createdBy', select: 'firstName lastName' }
      ]);

    // Debug: Log the number of bills found
    console.log('Bills found:', bills.length);
    if (bills.length > 0) {
      console.log('First bill date:', bills[0].billDate);
      console.log('Last bill date:', bills[bills.length - 1].billDate);
    }

    // Create a new workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Bills");

    // Define columns for each bill type - Updated to include remarks for commission
    const billTypeColumns: Record<BillType, any[]> = {
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
        { header: "VEHICLE NO", key: "vehicles", width: 20 },
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
        { header: "PAYMENT METHOD", key: "paymentMethod", width: 15 },
        { header: "AMOUNT", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
        { header: "REMARKS", key: "remarks", width: 30 }
      ]
    };

    // Determine which columns to use based on bill type filter
    let columns: any[] = [];
    if (req.query.billType && typeof req.query.billType === "string") {
      const billType = req.query.billType as BillType;
      columns = billTypeColumns[billType];
    } else {
      // If no bill type specified, use all possible columns (with unique keys)
      const allColumns = Object.values(billTypeColumns).flat();
      const uniqueColumns = allColumns.filter(
        (col, index, self) => index === self.findIndex((c) => c.key === col.key)
      );
      columns = uniqueColumns;
    }

    // Set the worksheet columns
    worksheet.columns = columns;

    // Add data rows with proper typing for populated fields
    bills.forEach((bill, index) => {
      const rowData: any = {
        sno: index + 1,
        billDate: bill.billDate,
        amount: bill.amount,
        paymentMethod: bill.paymentMethod,
        remarks: bill.remarks || "", // Now available for all bill types including commission
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
          // For fuel bills, use vehicles array (which now stores multiple vehicles)
          rowData.vehicles = bill.vehicles && Array.isArray(bill.vehicles)
            ? bill.vehicles.map(v => typeof v === 'object' ? v.vehicleNumber : "").join(", ")
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
          // Commission bills now include remarks field - no additional processing needed
          // since remarks is already set in the common fields above
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
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=bills_export_${new Date().toISOString().split("T")[0]
      }.xlsx`
    );

    // Write the workbook to the response
    await workbook.xlsx.write(res);
    res.end();
  }
);