import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Category } from "../models/categoryModel";

export const createCategory = asyncHandler(
  async (req: Request, res: Response) => {
    const { name, description } = req.body;

    if (!name) {
      throw new ApiError(400, "Category name is required");
    }

    // Check if category already exists
    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
      throw new ApiError(400, "Category with this name already exists");
    }

    const category = await Category.create({
      name,
      description,
      createdBy: req.user?.userId,
    });

    res
      .status(201)
      .json(new ApiResponse(201, category, "Category created successfully"));
  }
);

export const getCategories = asyncHandler(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const filter: any = {};

    // Search functionality
    if (req.query.search) {
      filter.name = { $regex: req.query.search, $options: "i" };
    }

    const total = await Category.countDocuments(filter);
    const categories = await Category.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ name: 1 })
      .populate("createdBy", "firstName lastName email");

    res.status(200).json(
      new ApiResponse(
        200,
        {
          categories,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
          },
        },
        "Categories retrieved successfully"
      )
    );
  }
);

export const getCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const category = await Category.findById(id).populate(
    "createdBy",
    "firstName lastName email"
  );
  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, category, "Category retrieved successfully"));
});

export const updateCategory = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, description } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      throw new ApiError(404, "Category not found");
    }

    // Check if name is being updated and conflicts with other categories
    if (name && name !== category.name) {
      const existingCategory = await Category.findOne({
        name,
        _id: { $ne: id },
      });

      if (existingCategory) {
        throw new ApiError(400, "Another category already uses this name");
      }
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      {
        name: name || category.name,
        description:
          description !== undefined ? description : category.description,
      },
      { new: true }
    );

    res
      .status(200)
      .json(
        new ApiResponse(200, updatedCategory, "Category updated successfully")
      );
  }
);

export const deleteCategory = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      throw new ApiError(404, "Category not found");
    }

    await Category.findByIdAndDelete(id);

    res
      .status(200)
      .json(new ApiResponse(200, null, "Category deleted successfully"));
  }
);
    