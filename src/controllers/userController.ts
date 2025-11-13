import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiHandlerHelpers";
import { ApiError } from "../utils/apiHandlerHelpers";
import { User } from "../models/userModel";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  deleteFileFromS3,
  uploadEmiratesIdDocument,
  uploadPassportDocument,
  uploadSignatureImage,
  uploadUserProfileImage,
} from "../utils/uploadConf";

interface UploadedFiles {
  profileImage?: Express.Multer.File[];
  signatureImage?: Express.Multer.File[];
  emiratesIdDocument?: Express.Multer.File[];
  passportDocument?: Express.Multer.File[];
}

const SALT_ROUNDS = 10;

const processFileUpload = async (
  file: Express.Multer.File | undefined,
  uploadFunction: any
) => {
  if (!file) return undefined;
  const result = await uploadFunction(file);
  return result.success && result.uploadData
    ? result.uploadData.url
    : undefined;
};

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const {
    email,
    password,
    phoneNumbers,
    firstName,
    lastName,
    role,
    salary,
    accountNumber,
    emiratesId,
    passportNumber,
    iBANNumber,
    address,
  } = req.body;

  // Only validate required fields
  if (!email || !password || !firstName || !lastName) {
    throw new ApiError(400, "Email, password, first name, and last name are required");
  }

  // Convert phoneNumbers to array if provided
  let phoneNumbersArray: string[] = [];

  if (phoneNumbers) {
    try {
      if (typeof phoneNumbers === "string") {
        const cleanedPhoneNumbers = phoneNumbers.replace(/'/g, '"');
        phoneNumbersArray = JSON.parse(cleanedPhoneNumbers);
      } else if (Array.isArray(phoneNumbers)) {
        phoneNumbersArray = phoneNumbers;
      } else {
        phoneNumbersArray = [phoneNumbers];
      }

      phoneNumbersArray = phoneNumbersArray.map((num) => String(num).trim());
      phoneNumbersArray = phoneNumbersArray.filter((num) => num.length > 0);
    } catch (e) {
      console.error("Error parsing phone numbers:", e);
      throw new ApiError(400, "Invalid phone numbers format");
    }
  }

  // Validate salary only if role is provided and not admin/super_admin
  if (role && !["super_admin", "admin"].includes(role) && (salary === undefined || salary === null)) {
    throw new ApiError(400, "Salary is required for this role");
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(400, "Email already in use");
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  const files = req.files as UploadedFiles;

  const [
    profileImageUrl,
    signatureImageUrl,
    emiratesIdDocumentUrl,
    passportDocumentUrl,
  ] = await Promise.all([
    processFileUpload(files.profileImage?.[0], uploadUserProfileImage),
    processFileUpload(files.signatureImage?.[0], uploadSignatureImage),
    processFileUpload(files.emiratesIdDocument?.[0], uploadEmiratesIdDocument),
    processFileUpload(files.passportDocument?.[0], uploadPassportDocument),
  ]);

  const userData: any = {
    email,
    password: hashedPassword,
    firstName,
    lastName,
    createdBy: req.user?.userId,
  };

  // Add optional fields only if provided
  if (phoneNumbersArray.length > 0) userData.phoneNumbers = phoneNumbersArray;
  if (role) userData.role = role;
  if (salary !== undefined && salary !== null && !["super_admin", "admin"].includes(role || "worker")) {
    userData.salary = salary;
  }
  if (accountNumber) userData.accountNumber = accountNumber;
  if (emiratesId) userData.emiratesId = emiratesId;
  if (passportNumber) userData.passportNumber = passportNumber;
  if (iBANNumber) userData.iBANNumber = iBANNumber;
  if (address) userData.address = address;
  if (profileImageUrl) userData.profileImage = profileImageUrl;
  if (signatureImageUrl) userData.signatureImage = signatureImageUrl;
  if (emiratesIdDocumentUrl) userData.emiratesIdDocument = emiratesIdDocumentUrl;
  if (passportDocumentUrl) userData.passportDocument = passportDocumentUrl;

  const user = await User.create(userData);

  res.status(201).json(new ApiResponse(201, user, "User created successfully"));
});


export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const filter: any = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.isActive) filter.isActive = req.query.isActive === "true";

  if (req.query.search) {
    const searchTerm = req.query.search as string;
    filter.$or = [
      { firstName: { $regex: searchTerm, $options: "i" } },
      { lastName: { $regex: searchTerm, $options: "i" } },
      { email: { $regex: searchTerm, $options: "i" } },
      {
        $expr: {
          $regexMatch: {
            input: { $concat: ["$firstName", " ", "$lastName"] },
            regex: searchTerm,
            options: "i",
          },
        },
      },
    ];
  }

  const total = await User.countDocuments(filter);
  const users = await User.find(filter, { password: 0 })
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        users,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      "Users retrieved successfully"
    )
  );
});
export const getCurrentUser = asyncHandler(async (req: Request, res: Response) => {
  // Get the authenticated user's ID from the request
  const userId = req.user?.userId;
  
  if (!userId) {
    throw new ApiError(401, "Not authenticated");
  }

  // Find the user and exclude the password field
  const user = await User.findById(userId)
    .select("-password")
    .lean();

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  res.status(200).json(
    new ApiResponse(
      200,
      {
        user: {
          ...user,
          // Add any additional fields or transformations here if needed
        }
      },
      "Current user retrieved successfully"
    )
  );
});
export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await User.findById(id).select("-password");

  if (!user) throw new ApiError(404, "User not found");

  if (
    user._id.toString() !== req.user?.userId &&
    req.user?.role !== "admin" &&
    req.user?.role !== "super_admin"
  ) {
    throw new ApiError(403, "Forbidden: Insufficient permissions");
  }

  res
    .status(200)
    .json(new ApiResponse(200, user, "User retrieved successfully"));
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const updateData = req.body;
  const files = req.files as UploadedFiles;

  const user = await User.findById(id);
  if (!user) throw new ApiError(404, "User not found");

  if (
    user._id.toString() !== req.user?.userId &&
    req.user?.role !== "admin" &&
    req.user?.role !== "super_admin"
  ) {
    throw new ApiError(403, "Forbidden: Insufficient permissions");
  }

  if (updateData.password) {
    updateData.password = await bcrypt.hash(updateData.password, SALT_ROUNDS);
  }

  // Handle phone numbers update
  if (updateData.phoneNumbers) {
    let phoneNumbersArray: string[] = [];

    try {
      if (typeof updateData.phoneNumbers === "string") {
        const cleanedPhoneNumbers = updateData.phoneNumbers.replace(/'/g, '"');
        phoneNumbersArray = JSON.parse(cleanedPhoneNumbers);
      } else if (Array.isArray(updateData.phoneNumbers)) {
        phoneNumbersArray = updateData.phoneNumbers;
      }

      phoneNumbersArray = phoneNumbersArray.map((num) => String(num).trim());
      updateData.phoneNumbers = phoneNumbersArray.filter((num) => num.length > 0);
    } catch (e) {
      console.error("Error parsing phone numbers:", e);
      throw new ApiError(400, "Invalid phone numbers format");
    }
  }

  // Process file uploads
  if (files.profileImage?.[0]) {
    const result = await uploadUserProfileImage(files.profileImage[0]);
    if (result.success && result.uploadData) {
      if (user.profileImage)
        await deleteFileFromS3(user.profileImage).catch(console.error);
      updateData.profileImage = result.uploadData.url;
    }
  }

  if (files.signatureImage?.[0]) {
    const result = await uploadSignatureImage(files.signatureImage[0]);
    if (result.success && result.uploadData) {
      if (user.signatureImage)
        await deleteFileFromS3(user.signatureImage).catch(console.error);
      updateData.signatureImage = result.uploadData.url;
    }
  }

  if (files.emiratesIdDocument?.[0]) {
    const result = await uploadEmiratesIdDocument(files.emiratesIdDocument[0]);
    if (result.success && result.uploadData) {
      if (user.emiratesIdDocument)
        await deleteFileFromS3(user.emiratesIdDocument).catch(console.error);
      updateData.emiratesIdDocument = result.uploadData.url;
    }
  }

  if (files.passportDocument?.[0]) {
    const result = await uploadPassportDocument(files.passportDocument[0]);
    if (result.success && result.uploadData) {
      if (user.passportDocument)
        await deleteFileFromS3(user.passportDocument).catch(console.error);
      updateData.passportDocument = result.uploadData.url;
    }
  }

  // Handle document removals
  if (updateData.removeProfileImage === "true") {
    if (user.profileImage)
      await deleteFileFromS3(user.profileImage).catch(console.error);
    updateData.profileImage = undefined;
    delete updateData.removeProfileImage;
  }

  if (updateData.removeSignatureImage === "true") {
    if (user.signatureImage)
      await deleteFileFromS3(user.signatureImage).catch(console.error);
    updateData.signatureImage = undefined;
    delete updateData.removeSignatureImage;
  }

  if (updateData.removeEmiratesIdDocument === "true") {
    if (user.emiratesIdDocument)
      await deleteFileFromS3(user.emiratesIdDocument).catch(console.error);
    updateData.emiratesIdDocument = undefined;
    delete updateData.removeEmiratesIdDocument;
  }

  if (updateData.removePassportDocument === "true") {
    if (user.passportDocument)
      await deleteFileFromS3(user.passportDocument).catch(console.error);
    updateData.passportDocument = undefined;
    delete updateData.removePassportDocument;
  }

  // Remove salary for admin/super_admin roles
  if (updateData.role && ["super_admin", "admin"].includes(updateData.role)) {
    updateData.salary = undefined;
  }

  const updatedUser = await User.findByIdAndUpdate(id, updateData, {
    new: true,
    select: "-password",
  });

  res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "User updated successfully"));
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await User.findById(id);

  if (!user) throw new ApiError(404, "User not found");
  if (user._id.toString() === req.user?.userId) {
    throw new ApiError(400, "Cannot delete your own account");
  }

  await User.findByIdAndDelete(id);
  res.status(200).json(new ApiResponse(200, null, "User deleted successfully"));
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password)
    throw new ApiError(400, "Email and password are required");

  const user = await User.findOne({ email }).select("+password");
  if (!user) throw new ApiError(401, "Invalid credentials");
  if (!user.isActive)
    throw new ApiError(403, "Account is inactive. Please contact admin.");

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) throw new ApiError(401, "Invalid credentials");

  const token = jwt.sign(
    { userId: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET || "alghaza_secret",
    { expiresIn: "7d" }
  );

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        token,
        user: {
          role: user.role,
          name: user.firstName,
          email: user.email,
        },
      },
      "Login successful"
    )
  );
});

export const getActiveEngineers = asyncHandler(
  async (req: Request, res: Response) => {
    const engineers = await User.find({
      role: "engineer",
      isActive: true,
    }).select("-v -password");
    res
      .status(200)
      .json(
        new ApiResponse(200, { engineers }, "Engineers retrieved successfully")
      );
  }
);

export const getActiveDrivers = asyncHandler(
  async (req: Request, res: Response) => {
    const drivers = await User.find({ role: "driver", isActive: true }).select(
      "-v -password"
    );
    res
      .status(200)
      .json(
        new ApiResponse(200, { drivers }, "Drivers retrieved successfully")
      );
  }
);
export const getActiveWorkers = asyncHandler(
  async (req: Request, res: Response) => {
    const workers = await User.find({ 
      role: { 
        $in: [
          "worker",
          "plumber",
          "electrician",
          "mason",
          "carpenter",
          "painter",
          "aluminium_fabricator",
          "plasterer",
          "ac_technician",
          "ac_assistant",
          "building_labourer",
          "helper",
          "cleaner",
          "senior_plumber",
          "mep_supervisor",
          "electrical_supervisor",
          "supervisor"
        ]
      }, 
      isActive: true 
    }).select("-v -password");

    res
      .status(200)
      .json(
        new ApiResponse(200, { workers }, "Workers retrieved successfully")
      );
  }
);

export const exportUsersToCSV = asyncHandler(async (req: Request, res: Response) => {
  // Get all users without pagination
  const users = await User.find({}, { password: 0 }).sort({ createdAt: -1 });

  if (!users || users.length === 0) {
    throw new ApiError(404, "No users found");
  }

  // Define CSV headers
  const headers = [
    "ID",
    "First Name",
    "Last Name",
    "Email",
    "Phone Numbers",
    "Role",
    "Salary",
    "Status",
    "Account Number",
    "Emirates ID",
    "Passport Number",
    "Address",
    "Created At",
  ];

  // Map user data to CSV rows
  const rows = users.map(user => [
    user._id,
    user.firstName,
    user.lastName,
    user.email,
    Array.isArray(user.phoneNumbers) ? user.phoneNumbers.join(", ") : "N/A",
    user.role,
    user.salary || "N/A",
    user.isActive ? "Active" : "Inactive",
    user.accountNumber || "N/A",
    user.emiratesId || "N/A",
    user.passportNumber || "N/A",
    user.address || "N/A",
    user.createdAt?.toISOString() || "N/A",
  ]);

  // Convert to CSV
  let csv = headers.join(",") + "\n";
  rows.forEach(row => {
    csv += row.map(field => {
      // Escape fields that contain commas
      if (typeof field === "string" && field.includes(",")) {
        return `"${field}"`;
      }
      return field;
    }).join(",") + "\n";
  });

  // Set response headers for file download
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=users_export.csv");
  
  // Send the CSV file
  res.status(200).send(csv);
});
