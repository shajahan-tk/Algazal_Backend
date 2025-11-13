import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse, ApiError } from "../utils/apiHandlerHelpers";
import { Bank } from "../models/bankDetailsModel";

// ✅ Create Bank
export const createBank = asyncHandler(async (req: Request, res: Response) => {
  const { bankName, accountName, accountNumber, iban, swiftCode } = req.body;

  if (!bankName || !accountName || !accountNumber || !iban || !swiftCode) {
    throw new ApiError(400, "All bank fields are required");
  }

  const existing = await Bank.findOne({
    $or: [{ accountNumber }, { iban }],
  });

  if (existing) {
    throw new ApiError(400, "Bank with this account number or IBAN already exists");
  }

  const bank = await Bank.create({
    bankName,
    accountName,
    accountNumber,
    iban,
    swiftCode,
  });

  res
    .status(201)
    .json(new ApiResponse(201, bank, "Bank details added successfully"));
});

// ✅ Get All Banks (with pagination & search)
export const getBanks = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const filter: any = {};

  if (req.query.search) {
    filter.$or = [
      { bankName: { $regex: req.query.search, $options: "i" } },
      { accountName: { $regex: req.query.search, $options: "i" } },
      { iban: { $regex: req.query.search, $options: "i" } },
    ];
  }

  const total = await Bank.countDocuments(filter);
  const banks = await Bank.find(filter)
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        banks,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      "Banks retrieved successfully"
    )
  );
});

// ✅ Get Single Bank
export const getBank = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const bank = await Bank.findById(id);
  if (!bank) {
    throw new ApiError(404, "Bank not found");
  }

  res.status(200).json(new ApiResponse(200, bank, "Bank retrieved successfully"));
});

// ✅ Update Bank
export const updateBank = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { bankName, accountName, accountNumber, iban, swiftCode } = req.body;

  const bank = await Bank.findById(id);
  if (!bank) {
    throw new ApiError(404, "Bank not found");
  }

  const existing = await Bank.findOne({
    _id: { $ne: id },
    $or: [{ accountNumber }, { iban }],
  });

  if (existing) {
    throw new ApiError(400, "Another bank uses this account number or IBAN");
  }

  const updatedBank = await Bank.findByIdAndUpdate(
    id,
    {
      bankName: bankName || bank.bankName,
      accountName: accountName || bank.accountName,
      accountNumber: accountNumber || bank.accountNumber,
      iban: iban || bank.iban,
      swiftCode: swiftCode || bank.swiftCode,
    },
    { new: true }
  );

  res
    .status(200)
    .json(new ApiResponse(200, updatedBank, "Bank updated successfully"));
});

// ✅ Delete Bank
export const deleteBank = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const bank = await Bank.findById(id);
  if (!bank) {
    throw new ApiError(404, "Bank not found");
  }

  await Bank.findByIdAndDelete(id);

  res
    .status(200)
    .json(new ApiResponse(200, null, "Bank deleted successfully"));
});
