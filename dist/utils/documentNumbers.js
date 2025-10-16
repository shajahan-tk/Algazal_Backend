"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRelatedDocumentNumber = exports.generateProjectNumber = void 0;
// utils/documentNumbers.ts
const projectModel_1 = require("../models/projectModel");
const generateProjectNumber = async () => {
    const year = new Date().getFullYear().toString().slice(-2);
    const count = await projectModel_1.Project.countDocuments();
    return `PRJAGA${year}${(count + 1).toString().padStart(4, "0")}`;
};
exports.generateProjectNumber = generateProjectNumber;
const generateRelatedDocumentNumber = async (projectId, prefix) => {
    const project = await projectModel_1.Project.findById(projectId);
    if (!project || !project.projectNumber) {
        throw new Error("Project not found or missing project number");
    }
    return project.projectNumber.replace("PRJAGA", prefix);
};
exports.generateRelatedDocumentNumber = generateRelatedDocumentNumber;
//# sourceMappingURL=documentNumbers.js.map