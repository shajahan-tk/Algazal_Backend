"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteBank = exports.updateBank = exports.getBank = exports.getBanks = exports.createBank = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const bankDetailsModel_1 = require("../models/bankDetailsModel");
// ✅ Create Bank
exports.createBank = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { bankName, accountName, accountNumber, iban, swiftCode } = req.body;
    if (!bankName || !accountName || !accountNumber || !iban || !swiftCode) {
        throw new apiHandlerHelpers_1.ApiError(400, "All bank fields are required");
    }
    const existing = await bankDetailsModel_1.Bank.findOne({
        $or: [{ accountNumber }, { iban }],
    });
    if (existing) {
        throw new apiHandlerHelpers_1.ApiError(400, "Bank with this account number or IBAN already exists");
    }
    const bank = await bankDetailsModel_1.Bank.create({
        bankName,
        accountName,
        accountNumber,
        iban,
        swiftCode,
    });
    res
        .status(201)
        .json(new apiHandlerHelpers_1.ApiResponse(201, bank, "Bank details added successfully"));
});
// ✅ Get All Banks (with pagination & search)
exports.getBanks = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = {};
    if (req.query.search) {
        filter.$or = [
            { bankName: { $regex: req.query.search, $options: "i" } },
            { accountName: { $regex: req.query.search, $options: "i" } },
            { iban: { $regex: req.query.search, $options: "i" } },
        ];
    }
    const total = await bankDetailsModel_1.Bank.countDocuments(filter);
    const banks = await bankDetailsModel_1.Bank.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        banks,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Banks retrieved successfully"));
});
// ✅ Get Single Bank
exports.getBank = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const bank = await bankDetailsModel_1.Bank.findById(id);
    if (!bank) {
        throw new apiHandlerHelpers_1.ApiError(404, "Bank not found");
    }
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, bank, "Bank retrieved successfully"));
});
// ✅ Update Bank
exports.updateBank = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { bankName, accountName, accountNumber, iban, swiftCode } = req.body;
    const bank = await bankDetailsModel_1.Bank.findById(id);
    if (!bank) {
        throw new apiHandlerHelpers_1.ApiError(404, "Bank not found");
    }
    const existing = await bankDetailsModel_1.Bank.findOne({
        _id: { $ne: id },
        $or: [{ accountNumber }, { iban }],
    });
    if (existing) {
        throw new apiHandlerHelpers_1.ApiError(400, "Another bank uses this account number or IBAN");
    }
    const updatedBank = await bankDetailsModel_1.Bank.findByIdAndUpdate(id, {
        bankName: bankName || bank.bankName,
        accountName: accountName || bank.accountName,
        accountNumber: accountNumber || bank.accountNumber,
        iban: iban || bank.iban,
        swiftCode: swiftCode || bank.swiftCode,
    }, { new: true });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedBank, "Bank updated successfully"));
});
// ✅ Delete Bank
exports.deleteBank = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const bank = await bankDetailsModel_1.Bank.findById(id);
    if (!bank) {
        throw new apiHandlerHelpers_1.ApiError(404, "Bank not found");
    }
    await bankDetailsModel_1.Bank.findByIdAndDelete(id);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, null, "Bank deleted successfully"));
});
//# sourceMappingURL=bankDetailsController.js.map