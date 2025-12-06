import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { Project } from "../models/projectModel";

// Set invoice date and remarks
export const setInvoiceDetails = asyncHandler(
    async (req: Request, res: Response) => {
        const { id } = req.params;
        const { invoiceDate, invoiceRemarks } = req.body;

        if (!invoiceDate) {
            throw new ApiError(400, "Invoice date is required");
        }

        const project = await Project.findById(id);
        if (!project) {
            throw new ApiError(404, "Project not found");
        }

        // Validate invoice date
        const parsedDate = new Date(invoiceDate);
        if (isNaN(parsedDate.getTime())) {
            throw new ApiError(400, "Invalid invoice date format");
        }

        const updatedProject = await Project.findByIdAndUpdate(
            id,
            {
                invoiceDate: parsedDate,
                invoiceRemarks: invoiceRemarks || "",
                updatedBy: req.user?.userId,
            },
            { new: true, runValidators: true }
        );

        res.status(200).json(
            new ApiResponse(200, updatedProject, "Invoice details set successfully")
        );
    }
);

// Get invoice details
export const getInvoiceDetails = asyncHandler(
    async (req: Request, res: Response) => {
        const { id } = req.params;

        const project = await Project.findById(id);
        if (!project) {
            throw new ApiError(404, "Project not found");
        }

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    invoiceDate: project.invoiceDate,
                    invoiceRemarks: project.invoiceRemarks,
                },
                "Invoice details retrieved successfully"
            )
        );
    }
);

// Clear invoice details
export const clearInvoiceDetails = asyncHandler(
    async (req: Request, res: Response) => {
        const { id } = req.params;

        const project = await Project.findById(id);
        if (!project) {
            throw new ApiError(404, "Project not found");
        }

        const updatedProject = await Project.findByIdAndUpdate(
            id,
            {
                invoiceDate: null,
                invoiceRemarks: "",
                updatedBy: req.user?.userId,
            },
            { new: true, runValidators: true }
        );

        res.status(200).json(
            new ApiResponse(200, updatedProject, "Invoice details cleared successfully")
        );
    }
);