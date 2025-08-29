"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectActivity = exports.addProjectComment = void 0;
const commentModel_1 = require("../models/commentModel");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const asyncHandler_1 = require("../utils/asyncHandler");
exports.addProjectComment = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const { content } = req.body;
    const userId = req.user?.userId;
    if (!content) {
        throw new apiHandlerHelpers_1.ApiError(400, "Comment content is required");
    }
    const comment = await commentModel_1.Comment.create({
        content,
        user: userId,
        project: projectId,
        actionType: "general",
    });
    const populatedComment = await commentModel_1.Comment.findById(comment._id).populate("user", "firstName lastName");
    res
        .status(201)
        .json(new apiHandlerHelpers_1.ApiResponse(201, populatedComment, "Comment added successfully"));
});
exports.getProjectActivity = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const activities = await commentModel_1.Comment.find({ project: projectId })
        .populate("user", "firstName lastName profileImage")
        .sort({ createdAt: -1 });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, activities, "Project activity retrieved successfully"));
});
//# sourceMappingURL=commentController.js.map