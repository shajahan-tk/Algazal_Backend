"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadUserProfileImage = uploadUserProfileImage;
exports.uploadEmiratesIdDocument = uploadEmiratesIdDocument;
exports.uploadPassportDocument = uploadPassportDocument;
exports.uploadItemImage = uploadItemImage;
exports.uploadSignatureImage = uploadSignatureImage;
exports.handleSingleFileUpload = handleSingleFileUpload;
exports.handleMultipleFileUploads = handleMultipleFileUploads;
exports.uploadExpenseDocument = uploadExpenseDocument;
exports.deleteFileFromS3 = deleteFileFromS3;
exports.getS3KeyFromUrl = getS3KeyFromUrl;
exports.uploadWorkCompletionImagesToS3 = uploadWorkCompletionImagesToS3;
const client_s3_1 = require("@aws-sdk/client-s3");
const lib_storage_1 = require("@aws-sdk/lib-storage");
const sharp_1 = __importDefault(require("sharp"));
const pdf_lib_1 = require("pdf-lib");
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const s3 = new client_s3_1.S3Client({
    region: "ap-south-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ||
            "",
    },
});
const BUCKET_NAME = "agats";
const USER_IMAGES_FOLDER = "user-images";
const ITEM_IMAGES_FOLDER = "item-images";
const SIGNATURES_FOLDER = "signatures";
const WORK_COMPLETION_FOLDER = "work-completion-images";
const EMIRATES_ID_FOLDER = "emirates-id-documents";
const PASSPORT_FOLDER = "passport-documents";
const EXPENSE_DOCUMENTS_FOLDER = "expense-documents";
function generateUniqueFileName(file) {
    const extension = path_1.default.extname(file.originalname);
    const filename = path_1.default.basename(file.originalname, extension);
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    return `${filename}-${uniqueSuffix}${extension}`;
}
async function uploadFileToS3(file, folder) {
    const uniqueFileName = folder
        ? `${folder}/${generateUniqueFileName(file)}`
        : generateUniqueFileName(file);
    const uploadParams = {
        Bucket: BUCKET_NAME,
        Key: uniqueFileName,
        Body: file.buffer,
        ContentType: file.mimetype,
    };
    const upload = new lib_storage_1.Upload({
        client: s3,
        params: uploadParams,
    });
    await upload.done();
    const fileUrl = `https://${BUCKET_NAME}.s3.ap-south-1.amazonaws.com/${encodeURIComponent(uniqueFileName)}`;
    return {
        url: fileUrl,
        key: uniqueFileName,
        mimetype: file.mimetype,
    };
}
async function processImage(file, options) {
    const { width = 800, height, format = "jpeg" } = options || {};
    let processor = (0, sharp_1.default)(file.buffer).resize({
        width,
        height,
        fit: "inside",
        withoutEnlargement: true,
    });
    if (format === "jpeg") {
        processor = processor.jpeg({ quality: 85, mozjpeg: true });
    }
    else {
        processor = processor.png({ quality: 90, compressionLevel: 8 });
    }
    return processor.toBuffer();
}
async function uploadUserProfileImage(file) {
    try {
        const processedFileBuffer = await (0, sharp_1.default)(file.buffer)
            .resize({ width: 500, height: 500, fit: "cover" })
            .jpeg({ quality: 80, mozjpeg: true })
            .toBuffer();
        const processedFile = {
            ...file,
            buffer: processedFileBuffer,
            mimetype: "image/jpeg",
        };
        const uploadResult = await uploadFileToS3(processedFile, USER_IMAGES_FOLDER);
        return {
            success: true,
            message: "User profile image uploaded successfully",
            uploadData: uploadResult,
        };
    }
    catch (err) {
        console.error("Error uploading user profile image:", err);
        return {
            success: false,
            message: "User profile image upload failed",
        };
    }
}
async function uploadEmiratesIdDocument(file) {
    try {
        // Validate file type
        const validTypes = ["image/jpeg", "image/png", "application/pdf"];
        if (!validTypes.includes(file.mimetype)) {
            return {
                success: false,
                message: "Invalid file type. Only JPEG, PNG, and PDF are allowed.",
            };
        }
        let processedFileBuffer;
        let processedMimeType = file.mimetype;
        if (file.mimetype.startsWith("image/")) {
            // Process images (resize and optimize)
            processedFileBuffer = await (0, sharp_1.default)(file.buffer)
                .resize({ width: 1200, fit: "inside", withoutEnlargement: true })
                .jpeg({ quality: 85, mozjpeg: true })
                .toBuffer();
            processedMimeType = "image/jpeg";
        }
        else if (file.mimetype === "application/pdf") {
            // Compress PDFs
            processedFileBuffer = await compressPDFBuffer(file.buffer);
        }
        const processedFile = {
            ...file,
            buffer: processedFileBuffer || file.buffer,
            mimetype: processedMimeType,
        };
        const uploadResult = await uploadFileToS3(processedFile, EMIRATES_ID_FOLDER);
        return {
            success: true,
            message: "Emirates ID document uploaded successfully",
            uploadData: uploadResult,
        };
    }
    catch (err) {
        console.error("Error uploading Emirates ID document:", err);
        return {
            success: false,
            message: "Emirates ID document upload failed",
        };
    }
}
async function uploadPassportDocument(file) {
    try {
        // Validate file type
        const validTypes = ["image/jpeg", "image/png", "application/pdf"];
        if (!validTypes.includes(file.mimetype)) {
            return {
                success: false,
                message: "Invalid file type. Only JPEG, PNG, and PDF are allowed.",
            };
        }
        let processedFileBuffer;
        let processedMimeType = file.mimetype;
        if (file.mimetype.startsWith("image/")) {
            // Process images (resize and optimize)
            processedFileBuffer = await (0, sharp_1.default)(file.buffer)
                .resize({ width: 1200, fit: "inside", withoutEnlargement: true })
                .jpeg({ quality: 85, mozjpeg: true })
                .toBuffer();
            processedMimeType = "image/jpeg";
        }
        else if (file.mimetype === "application/pdf") {
            // Compress PDFs
            processedFileBuffer = await compressPDFBuffer(file.buffer);
        }
        const processedFile = {
            ...file,
            buffer: processedFileBuffer || file.buffer,
            mimetype: processedMimeType,
        };
        const uploadResult = await uploadFileToS3(processedFile, PASSPORT_FOLDER);
        return {
            success: true,
            message: "Passport document uploaded successfully",
            uploadData: uploadResult,
        };
    }
    catch (err) {
        console.error("Error uploading Passport document:", err);
        return {
            success: false,
            message: "Passport document upload failed",
        };
    }
}
async function uploadItemImage(file) {
    try {
        console.log("inside uploadItemImage function", file);
        const processedFileBuffer = await (0, sharp_1.default)(file.buffer)
            .resize({ width: 800, height: 600, fit: "inside" })
            .jpeg({ quality: 80, mozjpeg: true })
            .toBuffer();
        const processedFile = {
            ...file,
            buffer: processedFileBuffer,
            mimetype: "image/jpeg",
        };
        const uploadResult = await uploadFileToS3(processedFile, ITEM_IMAGES_FOLDER);
        return {
            success: true,
            message: "Item image uploaded successfully",
            uploadData: uploadResult,
        };
    }
    catch (err) {
        console.error("Error uploading item image:", err);
        return {
            success: false,
            message: "Item image upload failed",
        };
    }
}
async function uploadSignatureImage(file) {
    try {
        const processedFileBuffer = await (0, sharp_1.default)(file.buffer)
            .resize({
            width: 400,
            height: 200,
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
            .png({ quality: 90, compressionLevel: 9 })
            .toBuffer();
        const processedFile = {
            ...file,
            buffer: processedFileBuffer,
            mimetype: "image/png",
        };
        const uploadResult = await uploadFileToS3(processedFile, SIGNATURES_FOLDER);
        return {
            success: true,
            message: "Signature image uploaded successfully",
            uploadData: uploadResult,
        };
    }
    catch (err) {
        console.error("Error uploading signature image:", err);
        return {
            success: false,
            message: "Signature image upload failed",
        };
    }
}
async function handleSingleFileUpload(file) {
    try {
        let processedFileBuffer;
        if (file.mimetype.startsWith("image/")) {
            processedFileBuffer = await processImage(file);
        }
        else if (file.mimetype === "application/pdf") {
            processedFileBuffer = await compressPDFBuffer(file.buffer);
        }
        const finalFile = {
            ...file,
            buffer: processedFileBuffer || file.buffer,
        };
        const uploadResult = await uploadFileToS3(finalFile);
        return {
            success: true,
            message: "File uploaded successfully",
            uploadData: uploadResult,
        };
    }
    catch (err) {
        console.error("Error uploading file:", err);
        return {
            success: false,
            message: "File upload failed",
        };
    }
}
async function handleMultipleFileUploads(files) {
    try {
        const uploadResults = await Promise.all(files.map(async (file) => {
            let processedFileBuffer;
            if (file.mimetype.startsWith("image/")) {
                processedFileBuffer = await processImage(file);
            }
            else if (file.mimetype === "application/pdf") {
                processedFileBuffer = await compressPDFBuffer(file.buffer);
            }
            const finalFile = {
                ...file,
                buffer: processedFileBuffer || file.buffer,
            };
            return await uploadFileToS3(finalFile);
        }));
        return {
            success: true,
            message: "Files uploaded successfully",
            uploadData: uploadResults,
        };
    }
    catch (err) {
        console.error("Error uploading files:", err);
        return {
            success: false,
            message: "File upload failed",
        };
    }
}
async function uploadExpenseDocument(file) {
    try {
        // Validate file type
        const validTypes = ["image/jpeg", "image/png", "application/pdf"];
        if (!validTypes.includes(file.mimetype)) {
            return {
                success: false,
                message: "Invalid file type. Only JPEG, PNG, and PDF are allowed.",
            };
        }
        let processedFileBuffer;
        let processedMimeType = file.mimetype;
        if (file.mimetype.startsWith("image/")) {
            // Process images (resize and optimize)
            processedFileBuffer = await (0, sharp_1.default)(file.buffer)
                .resize({ width: 1200, fit: "inside", withoutEnlargement: true })
                .jpeg({ quality: 85, mozjpeg: true })
                .toBuffer();
            processedMimeType = "image/jpeg";
        }
        else if (file.mimetype === "application/pdf") {
            // Compress PDFs
            processedFileBuffer = await compressPDFBuffer(file.buffer);
        }
        const processedFile = {
            ...file,
            buffer: processedFileBuffer || file.buffer,
            mimetype: processedMimeType,
        };
        const uploadResult = await uploadFileToS3(processedFile, EXPENSE_DOCUMENTS_FOLDER);
        return {
            success: true,
            message: "Expense document uploaded successfully",
            uploadData: uploadResult,
        };
    }
    catch (err) {
        console.error("Error uploading expense document:", err);
        return {
            success: false,
            message: "Expense document upload failed",
        };
    }
}
async function deleteFileFromS3(key) {
    try {
        const deleteParams = {
            Bucket: BUCKET_NAME,
            Key: key,
        };
        const command = new client_s3_1.DeleteObjectCommand(deleteParams);
        await s3.send(command);
        return {
            success: true,
            message: `File deleted successfully: ${key}`,
        };
    }
    catch (err) {
        console.error(`Error deleting file from S3: ${err}`);
        return {
            success: false,
            message: "Failed to delete file from S3",
        };
    }
}
function getS3KeyFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return decodeURIComponent(urlObj.pathname.substring(1));
    }
    catch (err) {
        console.error("Error parsing S3 URL:", err);
        throw new Error("Invalid S3 URL");
    }
}
async function compressPDFBuffer(pdfBuffer) {
    try {
        const pdfDoc = await pdf_lib_1.PDFDocument.load(pdfBuffer);
        const compressedPDFBytes = await pdfDoc.save();
        return Buffer.from(compressedPDFBytes);
    }
    catch (error) {
        console.error("Error compressing PDF:", error);
        throw new Error("Failed to compress PDF");
    }
}
async function uploadWorkCompletionImagesToS3(files) {
    try {
        const uploadResults = await Promise.all(files.map(async (file) => {
            let processedFileBuffer;
            if (file.mimetype.startsWith("image/")) {
                processedFileBuffer = await processImage(file);
            }
            const finalFile = {
                ...file,
                buffer: processedFileBuffer || file.buffer,
            };
            return await uploadFileToS3(finalFile, WORK_COMPLETION_FOLDER);
        }));
        return {
            success: true,
            message: "Work completion images uploaded successfully",
            uploadData: uploadResults,
        };
    }
    catch (err) {
        console.error("Error uploading work completion images:", err);
        return {
            success: false,
            message: "Work completion images upload failed",
        };
    }
}
exports.default = {
    uploadUserProfileImage,
    uploadItemImage,
    uploadSignatureImage,
    handleSingleFileUpload,
    handleMultipleFileUploads,
    deleteFileFromS3,
    getS3KeyFromUrl,
};
//# sourceMappingURL=uploadConf.js.map