"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addApartmentToBuilding = exports.addBuildingToLocation = exports.addLocationToClient = exports.getClientsByPincode = exports.getClientByTrn = exports.deleteClient = exports.updateClient = exports.getClient = exports.getClients = exports.createClient = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const clientModel_1 = require("../models/clientModel");
exports.createClient = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { clientName, clientAddress, pincode, mobileNumber, telephoneNumber, trnNumber, email, accountNumber, locations, } = req.body;
    // Validate required fields - only clientName is required
    if (!clientName) {
        throw new apiHandlerHelpers_2.ApiError(400, "Client name is required");
    }
    // Check if TRN already exists (only if TRN is provided)
    if (trnNumber) {
        const existingClient = await clientModel_1.Client.findOne({ trnNumber });
        if (existingClient) {
            throw new apiHandlerHelpers_2.ApiError(400, "Client with this TRN already exists");
        }
    }
    const client = await clientModel_1.Client.create({
        clientName,
        clientAddress,
        pincode,
        mobileNumber,
        telephoneNumber,
        trnNumber,
        email,
        accountNumber,
        locations,
        createdBy: req.user?.userId,
    });
    res
        .status(201)
        .json(new apiHandlerHelpers_1.ApiResponse(201, client, "Client created successfully"));
});
exports.getClients = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = {};
    // Search functionality
    if (req.query.search) {
        filter.$or = [
            { clientName: { $regex: req.query.search, $options: "i" } },
            { trnNumber: { $regex: req.query.search, $options: "i" } },
            { mobileNumber: { $regex: req.query.search, $options: "i" } },
            { pincode: { $regex: req.query.search, $options: "i" } },
            { accountNumber: { $regex: req.query.search, $options: "i" } },
        ];
    }
    // Filter by pincode if provided
    if (req.query.pincode) {
        filter.pincode = req.query.pincode;
    }
    const total = await clientModel_1.Client.countDocuments(filter);
    const clients = await clientModel_1.Client.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate("createdBy", "firstName lastName email");
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        clients,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Clients retrieved successfully"));
});
exports.getClient = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const client = await clientModel_1.Client.findById(id).populate("createdBy", "firstName lastName email");
    if (!client) {
        throw new apiHandlerHelpers_2.ApiError(404, "Client not found");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, client, "Client retrieved successfully"));
});
exports.updateClient = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { clientName, clientAddress, pincode, mobileNumber, telephoneNumber, trnNumber, email, accountNumber, locations, } = req.body;
    const client = await clientModel_1.Client.findById(id);
    if (!client) {
        throw new apiHandlerHelpers_2.ApiError(404, "Client not found");
    }
    // Check if TRN is being updated and conflicts with other clients
    if (trnNumber && trnNumber !== client.trnNumber) {
        const existingClient = await clientModel_1.Client.findOne({
            trnNumber,
            _id: { $ne: id },
        });
        if (existingClient) {
            throw new apiHandlerHelpers_2.ApiError(400, "Another client already uses this TRN");
        }
    }
    const updatedClient = await clientModel_1.Client.findByIdAndUpdate(id, {
        clientName: clientName || client.clientName,
        clientAddress: clientAddress || client.clientAddress,
        pincode: pincode || client.pincode,
        mobileNumber: mobileNumber || client.mobileNumber,
        telephoneNumber: telephoneNumber !== undefined
            ? telephoneNumber
            : client.telephoneNumber,
        trnNumber: trnNumber || client.trnNumber,
        email: email || client.email,
        accountNumber: accountNumber !== undefined ? accountNumber : client.accountNumber,
        locations: locations !== undefined ? locations : client.locations,
    }, { new: true });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedClient, "Client updated successfully"));
});
exports.deleteClient = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const client = await clientModel_1.Client.findByIdAndDelete(id);
    if (!client) {
        throw new apiHandlerHelpers_2.ApiError(404, "Client not found");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, null, "Client deleted successfully"));
});
exports.getClientByTrn = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { trnNumber } = req.params;
    const client = await clientModel_1.Client.findOne({ trnNumber }).populate("createdBy", "firstName lastName email");
    if (!client) {
        throw new apiHandlerHelpers_2.ApiError(404, "Client not found");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, client, "Client retrieved successfully"));
});
exports.getClientsByPincode = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { pincode } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    if (!/^[0-9]{6}$/.test(pincode)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid pincode format");
    }
    const total = await clientModel_1.Client.countDocuments({ pincode });
    const clients = await clientModel_1.Client.find({ pincode })
        .skip(skip)
        .limit(limit)
        .sort({ clientName: 1 })
        .populate("createdBy", "firstName lastName email");
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        clients,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Clients retrieved successfully"));
});
// Additional helper functions for locations/buildings/apartments
exports.addLocationToClient = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) {
        throw new apiHandlerHelpers_2.ApiError(400, "Location name is required");
    }
    const client = await clientModel_1.Client.findByIdAndUpdate(id, { $push: { locations: { name } } }, { new: true });
    if (!client) {
        throw new apiHandlerHelpers_2.ApiError(404, "Client not found");
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, client, "Location added successfully"));
});
exports.addBuildingToLocation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { clientId, locationId } = req.params;
    const { name } = req.body;
    if (!name) {
        throw new apiHandlerHelpers_2.ApiError(400, "Building name is required");
    }
    const client = await clientModel_1.Client.findById(clientId);
    if (!client) {
        throw new apiHandlerHelpers_2.ApiError(404, "Client not found");
    }
    const location = client.locations.id(locationId);
    if (!location) {
        throw new apiHandlerHelpers_2.ApiError(404, "Location not found");
    }
    location.buildings.push({ name, apartments: [] });
    await client.save();
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, client, "Building added successfully"));
});
exports.addApartmentToBuilding = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { clientId, locationId, buildingId } = req.params;
    const { number } = req.body;
    if (!number) {
        throw new apiHandlerHelpers_2.ApiError(400, "Apartment number is required");
    }
    const client = await clientModel_1.Client.findById(clientId);
    if (!client) {
        throw new apiHandlerHelpers_2.ApiError(404, "Client not found");
    }
    const location = client.locations.id(locationId);
    if (!location) {
        throw new apiHandlerHelpers_2.ApiError(404, "Location not found");
    }
    const building = location.buildings.id(buildingId);
    if (!building) {
        throw new apiHandlerHelpers_2.ApiError(404, "Building not found");
    }
    building.apartments.push({ number });
    await client.save();
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, client, "Apartment added successfully"));
});
//# sourceMappingURL=clientController.js.map