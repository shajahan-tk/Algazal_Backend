"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCategory = exports.updateCategory = exports.getCategory = exports.getCategories = exports.createCategory = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const categoryModel_1 = require("../models/categoryModel");
exports.createCategory = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { name, description } = req.body;
    if (!name) {
        throw new apiHandlerHelpers_2.ApiError(400, "Category name is required");
    }
    // Check if category already exists
    const existingCategory = await categoryModel_1.Category.findOne({ name });
    if (existingCategory) {
        throw new apiHandlerHelpers_2.ApiError(400, "Category with this name already exists");
    }
    const category = await categoryModel_1.Category.create({
        name,
        description,
        createdBy: req.user?.userId,
    });
    res
        .status(201)
        .json(new apiHandlerHelpers_1.ApiResponse(201, category, "Category created successfully"));
});
exports.getCategories = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = {};
    // Search functionality
    if (req.query.search) {
        filter.name = { $regex: req.query.search, $options: "i" };
    }
    const total = await categoryModel_1.Category.countDocuments(filter);
    const categories = await categoryModel_1.Category.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ name: 1 })
        .populate("createdBy", "firstName lastName email");
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        categories,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Categories retrieved successfully"));
});
exports.getCategory = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const category = await categoryModel_1.Category.findById(id).populate("createdBy", "firstName lastName email");
    if (!category) {
        throw new apiHandlerHelpers_2.ApiError(404, "Category not found");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, category, "Category retrieved successfully"));
});
exports.updateCategory = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    const category = await categoryModel_1.Category.findById(id);
    if (!category) {
        throw new apiHandlerHelpers_2.ApiError(404, "Category not found");
    }
    // Check if name is being updated and conflicts with other categories
    if (name && name !== category.name) {
        const existingCategory = await categoryModel_1.Category.findOne({
            name,
            _id: { $ne: id },
        });
        if (existingCategory) {
            throw new apiHandlerHelpers_2.ApiError(400, "Another category already uses this name");
        }
    }
    const updatedCategory = await categoryModel_1.Category.findByIdAndUpdate(id, {
        name: name || category.name,
        description: description !== undefined ? description : category.description,
    }, { new: true });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedCategory, "Category updated successfully"));
});
exports.deleteCategory = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const category = await categoryModel_1.Category.findById(id);
    if (!category) {
        throw new apiHandlerHelpers_2.ApiError(404, "Category not found");
    }
    await categoryModel_1.Category.findByIdAndDelete(id);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, null, "Category deleted successfully"));
});
//# sourceMappingURL=categoryController.js.map