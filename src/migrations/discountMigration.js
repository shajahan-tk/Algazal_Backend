// scripts/addDiscountToQuotations.js

const mongoose = require('mongoose');
const Quotation = require('../models/quotationModel');
require('dotenv').config();

async function addDiscountToQuotations() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log('Connected to MongoDB');

        // Find all quotations without a discountAmount field
        const quotations = await Quotation.find({ discountAmount: { $exists: false } });

        console.log(`Found ${quotations.length} quotations without discount amount`);

        // Update each quotation to add discountAmount with default value of 0
        for (const quotation of quotations) {
            quotation.discountAmount = 0;
            await quotation.save();
            console.log(`Updated quotation ${quotation._id}`);
        }

        console.log('Migration completed successfully');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        // Close the connection
        await mongoose.connection.close();
    }
}

addDiscountToQuotations();