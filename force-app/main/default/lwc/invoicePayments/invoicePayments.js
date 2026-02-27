import { LightningElement, api, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getInvoiceDetails from '@salesforce/apex/InvoicePayments.getInvoiceDetails';
import createInvoicePayment from '@salesforce/apex/InvoicePayments.createInvoicePayment';
import getPaymentHistory from '@salesforce/apex/InvoicePayments.getPaymentHistory';

export default class InvoicePayments extends LightningElement {
    @api recordId;
    
    // Invoice Data
    invoiceData = {};
    wiredInvoiceResult = null;
    paymentHistory = [];
    wiredPaymentHistoryResult = null;
    
    // UI States
    isLoading = false;
    isSaving = false;
    errorMessage = '';
    showPaymentHistoryModal = false;
    
    // Payment Form
    selectedPaymentMode = null;
    paymentAmount = null;
    paymentNote = '';
    paymentType = null;
    showPaymentForm = false;
    
    // Dynamic form fields
    formFields = {};

    // Payment modes configuration
    paymentModes = [
        { label: 'Cash', value: 'Cash' },
        { label: 'UPI', value: 'UPI' },
        { label: 'Card', value: 'Card' },
        { label: 'Bank Transfer', value: 'Bank Transfer' }
    ];

    // Card type options
    cardTypeOptions = [
        { label: 'Visa', value: 'Visa' },
        { label: 'MasterCard', value: 'MasterCard' },
        { label: 'RuPay', value: 'RuPay' },
        { label: 'Amex', value: 'Amex' },
        { label: 'Others', value: 'Others' }
    ];

    // UPI App Name options
    upiAppNameOptions = [
        { label: 'GPay', value: 'GPay' },
        { label: 'PhonePe', value: 'PhonePe' },
        { label: 'Paytm', value: 'Paytm' },
        { label: 'BHIM', value: 'BHIM' },
        { label: 'Other', value: 'Other' }
    ];

    // Dynamic field templates based on payment mode
    paymentModeFields = {
        'Cash': [
            { name: 'cashReceivedBy', label: 'Cash Received By', type: 'text', required: true },
            { name: 'cashReceiptNumber', label: 'Cash Receipt Number', type: 'text', required: true }
        ],
        'UPI': [
            { name: 'upiAppName', label: 'UPI App Name', type: 'picklist', required: true },
            { name: 'upiId', label: 'UPI ID', type: 'text', required: true },
            { name: 'nameOnUpi', label: 'Name On UPI', type: 'text', required: true }
        ],
        'Card': [
            { name: 'cardHolderName', label: 'Card Holder Name', type: 'text', required: true },
            { name: 'cardNumber', label: 'Card Number', type: 'text', required: true },
            { name: 'cardType', label: 'Card Type', type: 'combobox', required: true }
        ],
        'Bank Transfer': [
            { name: 'bankName', label: 'Bank Name', type: 'text', required: true },
            { name: 'ifscCode', label: 'IFSC Code', type: 'text', required: true },
            { name: 'bankAccountNumber', label: 'Bank Account Number', type: 'text', required: true }
        ]
    };

    /**
     * Wire service to fetch invoice details
     */
    @wire(getInvoiceDetails, { invoiceId: '$recordId' })
    wiredInvoice(result) {
        this.wiredInvoiceResult = result;
        const { error, data } = result;
        
        if (data) {
            this.invoiceData = data;
            this.errorMessage = '';
            this.paymentType = null;
        } else if (error) {
            this.errorMessage = this.getErrorMessage(error);
            this.invoiceData = {};
            console.error('Error fetching invoice:', error);
        }
    }

    /**
     * Wire service to fetch payment history
     */
    @wire(getPaymentHistory, { invoiceId: '$recordId' })
    wiredPaymentHistory(result) {
        this.wiredPaymentHistoryResult = result;
        const { error, data } = result;
        
        if (data) {
            this.paymentHistory = data;
        } else if (error) {
            console.error('Error fetching payment history:', error);
            this.paymentHistory = [];
        }
    }

    /**
     * Extract error message from various error formats
     */
    getErrorMessage(error) {
        if (error.body && error.body.message) {
            return error.body.message;
        }
        if (error.body && error.body.exceptionMessage) {
            return error.body.exceptionMessage;
        }
        if (typeof error === 'string') {
            return error;
        }
        return 'An error occurred';
    }

    /**
     * Handle error alert close
     */
    handleErrorClose() {
        this.errorMessage = '';
    }

    /**
     * Handle payment mode selection
     */
    handlePaymentModeSelect(event) {
        const mode = event.currentTarget.dataset.mode;
        this.selectedPaymentMode = mode;
        this.formFields = {};
        
        // Initialize form fields for selected mode
        const fields = this.paymentModeFields[mode] || [];
        fields.forEach(field => {
            this.formFields[field.name] = '';
        });
        
        this.showPaymentForm = true;

        // Scroll to payment details card
        setTimeout(() => {
            const paymentDetailsCard = this.template.querySelector('[lwc\\:ref="paymentDetailsCard"]');
            if (paymentDetailsCard) {
                paymentDetailsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    }

    /**
     * Handle payment amount input
     */
    handleAmountChange(event) {
        this.paymentAmount = event.detail.value;
    }

    /**
     * Handle dynamic field changes
     */
    handleFieldChange(event) {
        const fieldName = event.currentTarget.dataset.field;
        this.formFields[fieldName] = event.detail.value;
    }

    /**
     * Handle card type selection
     */
    handleCardTypeChange(event) {
        this.formFields.cardType = event.detail.value;
    }

    /**
     * Handle UPI app name selection
     */
    handleUpiAppNameChange(event) {
        this.formFields.upiAppName = event.detail.value;
    }

    /**
     * Handle payment notes
     */
    handleNotesChange(event) {
        this.paymentNote = event.detail.value;
    }

    /**
     * Generate unique transaction ID
     */
    generateUniqueId() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 100000000);
        const checksum = (timestamp + random) % 9999;
        return `${timestamp}${random}${checksum}`.substring(0, 20);
    }

    /**
     * Generate UPI Reference Number with PaymentType-Amount-DateTime_Seconds format
     * Format: UPI-DDMMYY-HHMMSS-Amount-RandomSuffix
     */
    generateUpiReferenceNumber(amount) {
        const now = new Date();
        
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2);
        
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        
        const dateStr = `${day}${month}${year}`;
        const timeStr = `${hours}${minutes}${seconds}`;
        const amountStr = String(Math.floor(amount)).padStart(8, '0');
        
        // Generate random alphanumeric suffix (4 characters)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let randomSuffix = '';
        for (let i = 0; i < 4; i++) {
            randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        // Add milliseconds for extra uniqueness
        const uniqueId = String(milliseconds) + randomSuffix;
        
        return `UPI-${dateStr}-${timeStr}-${amountStr}-${uniqueId}`;
    }

    /**
     * Generate Transaction ID with mode-specific prefix
     */
    generateTransactionId(mode, amount = 0) {
        switch(mode) {
            case 'UPI':
                return this.generateUpiReferenceNumber(amount);
            case 'Card':
                return this.generateCardTransactionId(amount);
            case 'Bank Transfer':
                return this.generateBankTransactionId(amount);
            case 'Cash':
                return this.generateCashReceiptNumber(amount);
            default:
                return this.generateGenericTransactionId(amount);
        }
    }

    /**
     * Generate Card Transaction ID
     */
    generateCardTransactionId(amount) {
        const now = new Date();
        
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2);
        
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        
        const dateStr = `${day}${month}${year}`;
        const timeStr = `${hours}${minutes}${seconds}`;
        const amountStr = String(Math.floor(amount)).padStart(8, '0');
        const cardType = (this.formFields.cardType || 'CARD').substring(0, 4).toUpperCase();
        
        // Generate random alphanumeric suffix
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let randomSuffix = '';
        for (let i = 0; i < 4; i++) {
            randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const uniqueId = String(milliseconds) + randomSuffix;
        
        return `${cardType}-${dateStr}-${timeStr}-${amountStr}-${uniqueId}`;
    }

    /**
     * Generate Bank Transfer Transaction ID
     */
    generateBankTransactionId(amount) {
        const now = new Date();
        
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2);
        
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        
        const dateStr = `${day}${month}${year}`;
        const timeStr = `${hours}${minutes}${seconds}`;
        const amountStr = String(Math.floor(amount)).padStart(8, '0');
        const bankName = (this.formFields.bankName || 'BANK').substring(0, 4).toUpperCase();
        
        // Generate random alphanumeric suffix
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let randomSuffix = '';
        for (let i = 0; i < 4; i++) {
            randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const uniqueId = String(milliseconds) + randomSuffix;
        
        return `${bankName}-${dateStr}-${timeStr}-${amountStr}-${uniqueId}`;
    }

    /**
     * Generate Cash Receipt Number
     */
    generateCashReceiptNumber(amount) {
        const now = new Date();
        
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2);
        
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        
        const dateStr = `${day}${month}${year}`;
        const timeStr = `${hours}${minutes}${seconds}`;
        const amountStr = String(Math.floor(amount)).padStart(8, '0');
        
        // Generate random alphanumeric suffix
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let randomSuffix = '';
        for (let i = 0; i < 4; i++) {
            randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const uniqueId = String(milliseconds) + randomSuffix;
        
        return `CASH-${dateStr}-${timeStr}-${amountStr}-${uniqueId}`;
    }

    /**
     * Generate Generic Transaction ID
     */
    generateGenericTransactionId(amount) {
        const now = new Date();
        
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2);
        
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        
        const dateStr = `${day}${month}${year}`;
        const timeStr = `${hours}${minutes}${seconds}`;
        const amountStr = String(Math.floor(amount)).padStart(8, '0');
        
        // Generate random alphanumeric suffix
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let randomSuffix = '';
        for (let i = 0; i < 4; i++) {
            randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const uniqueId = String(milliseconds) + randomSuffix;
        
        return `TXN-${dateStr}-${timeStr}-${amountStr}-${uniqueId}`;
    }

    /**
     * Submit payment
     */
    async handleSubmitPayment() {
        // Validate form
        if (!this.validatePaymentForm()) {
            return;
        }

        this.isSaving = true;

        try {
            // Auto-generate Transaction ID for all payment modes
            const formFieldsCopy = { ...this.formFields };
            const transactionId = this.generateTransactionId(this.selectedPaymentMode, parseFloat(this.paymentAmount));
            
            // Store transaction ID in appropriate field based on payment mode
            switch(this.selectedPaymentMode) {
                case 'UPI':
                    formFieldsCopy.upiReferenceNumber = transactionId;
                    break;
                case 'Card':
                    formFieldsCopy.transactionId = transactionId;
                    break;
                case 'Bank Transfer':
                    formFieldsCopy.transactionReference = transactionId;
                    break;
                case 'Cash':
                    formFieldsCopy.cashReceiptNumber = transactionId;
                    break;
            }

            // Build wrapper object
            const wrapper = {
                invoiceId: this.invoiceData.Id,
                customerId: this.invoiceData.AMERP_Customer__c,
                paymentAmount: parseFloat(this.paymentAmount),
                paymentDate: new Date().toISOString().split('T')[0],
                paymentMode: this.selectedPaymentMode,
                paymentStatus: 'Received',
                paymentNote: this.paymentNote,
                ...formFieldsCopy
            };

            // Call Apex method
            const result = await createInvoicePayment({ wrapper });

            if (result) {
                // Show success message
                this.showToast('Success', 'Payment recorded successfully', 'success');
                
                // Reset form
                this.resetPaymentForm();
                
                // Refresh both invoice and payment history data
                await this.refreshAllData();
            }
        } catch (error) {
            const errorMsg = this.getErrorMessage(error);
            this.showToast('Error', errorMsg, 'error');
            console.error('Payment error:', error);
        } finally {
            this.isSaving = false;
        }
    }

    /**
     * Validate payment form
     */
    validatePaymentForm() {
        // Check amount
        if (!this.paymentAmount || parseFloat(this.paymentAmount) <= 0) {
            this.showToast('Validation Error', 'Please enter a valid amount', 'error');
            return false;
        }

        // Check amount doesn't exceed outstanding
        if (parseFloat(this.paymentAmount) > (this.outstandingAmount || 0)) {
            this.showToast('Validation Error', 'Payment amount cannot exceed outstanding amount', 'error');
            return false;
        }

        // Check required dynamic fields
        const fields = this.paymentModeFields[this.selectedPaymentMode] || [];
        for (const field of fields) {
            if (field.required && !this.formFields[field.name]) {
                this.showToast('Validation Error', `${field.label} is required`, 'error');
                return false;
            }
        }

        return true;
    }

    /**
     * Refresh all data (invoice and payment history)
     */
    async refreshAllData() {
        try {
            if (this.wiredInvoiceResult) {
                await refreshApex(this.wiredInvoiceResult);
            }
            if (this.wiredPaymentHistoryResult) {
                await refreshApex(this.wiredPaymentHistoryResult);
            }
        } catch (error) {
            console.error('Error refreshing data:', error);
        }
    }

    /**
     * Handle refresh data button click
     */
    async handleRefreshData() {
        this.isLoading = true;
        try {
            await this.refreshAllData();
            this.showToast('Success', 'Data refreshed successfully', 'success');
        } catch (error) {
            this.showToast('Error', 'Failed to refresh data', 'error');
            console.error('Refresh error:', error);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Reset payment form
     */
    resetPaymentForm() {
        this.selectedPaymentMode = null;
        this.paymentAmount = null;
        this.paymentNote = '';
        this.paymentType = null;
        this.formFields = {};
        this.showPaymentForm = false;
    }

    /**
     * Show toast notification
     */
    showToast(title, message, variant) {
        const evt = new ShowToastEvent({
            title,
            message,
            variant
        });
        this.dispatchEvent(evt);
    }

    /**
     * Getters for display values
     */
    get invoiceAmount() {
        return this.invoiceData?.AMERP_Invoice_Amount__c ?? 0;
    }

    get totalPaidAmount() {
        return this.invoiceData?.AMERP_Total_Paid_Amount__c ?? 0;
    }

    get outstandingAmount() {
        return this.invoiceData?.AMERP_Outstanding_Amount__c ?? 0;
    }

    get hasInvoiceData() {
        return this.invoiceData && this.invoiceData.Id;
    }

    get currencyCode() {
        return this.invoiceData?.CurrencyIsoCode || 'USD';
    }

    get isPayButtonDisabled() {
        const outstanding = parseFloat(this.outstandingAmount) || 0;
        const amount = parseFloat(this.paymentAmount) || 0;
        return amount <= 0 || amount > outstanding || this.isSaving;
    }

    get currentModeFields() {
        return this.paymentModeFields[this.selectedPaymentMode] || [];
    }

    get isPaymentModeSelected() {
        return this.selectedPaymentMode !== null;
    }

    /**
     * Get CSS class for payment mode button
     */
    getPaymentModeButtonClass(mode) {
        const baseClass = 'payment-mode-btn';
        const selectedClass = this.selectedPaymentMode === mode ? ' selected' : '';
        return baseClass + selectedClass;
    }

    /**
     * Get payment icon for button
     */
    getPaymentIcon(mode) {
        const icons = {
            'Cash': '💵',
            'UPI': '📲',
            'Card': '💳',
            'Bank Transfer': '🏦'
        };
        return icons[mode] || '💰';
    }

    /**
     * Get field value from form fields
     */
    getFieldValue(fieldName) {
        return this.formFields[fieldName] || '';
    }

    /**
     * Get placeholder text based on field name
     */
    getFieldPlaceholder(fieldName) {
        const placeholders = {
            'cashReceivedBy': 'Enter name of person who received cash',
            'cashReceiptNumber': 'Enter cash receipt number',
            'upiId': 'Enter UPI ID (e.g., user@upiapp)',
            'nameOnUpi': 'Enter name on UPI account',
            'cardHolderName': 'Enter card holder name',
            'cardNumber': 'Enter card number',
            'bankName': 'Enter bank name',
            'ifscCode': 'Enter IFSC code',
            'bankAccountNumber': 'Enter bank account number'
        };
        return placeholders[fieldName] || '';
    }

    /**
     * Get field label with icon based on field name
     */
    getFieldLabelWithIcon(fieldName) {
        const iconMap = {
            'cashReceivedBy': '👤 Cash Received By',
            'cashReceiptNumber': '🧾 Cash Receipt Number',
            'upiAppName': '📱 UPI App Name',
            'upiId': '🆔 UPI ID',
            'nameOnUpi': '👤 Name On UPI',
            'cardHolderName': '👤 Card Holder Name',
            'cardNumber': '🔢 Card Number',
            'cardType': '🳳 Card Type',
            'bankName': '🏦 Bank Name',
            'ifscCode': '🔐 IFSC Code',
            'bankAccountNumber': '💳 Bank Account Number'
        };
        return iconMap[fieldName] || fieldName;
    }

    /**
     * Get helper text for field based on field name
     */
    getFieldHelperText(fieldName) {
        const helperText = {
            'cashReceivedBy': 'Name of the person who received the cash payment',
            'cashReceiptNumber': 'Receipt number for the cash transaction',
            'upiAppName': 'Select the UPI application used (GPay, PhonePe, Paytm, etc.)',
            'upiId': 'Your UPI ID in format: username@bankname',
            'nameOnUpi': 'Name associated with your UPI account',
            'cardHolderName': 'Name of the card holder (as shown on card)',
            'cardNumber': 'Last 4 digits or full card number (stored securely)',
            'cardType': 'Type of card (Visa, MasterCard, RuPay, etc.)',
            'bankName': 'Name of the bank for transfer',
            'ifscCode': 'IFSC code of the bank branch',
            'bankAccountNumber': 'Account number for the bank transfer (up to 20 characters)'
        };
        return helperText[fieldName] || '';
    }

    /**
     * Check if the field is card type field
     */
    isCardTypeField(fieldName) {
        return fieldName === 'cardType';
    }

    /**
     * Check if the field is UPI app name field
     */
    isUpiAppNameField(fieldName) {
        return fieldName === 'upiAppName';
    }

    /**
     * Open payment history modal
     */
    openPaymentHistory() {
        this.showPaymentHistoryModal = true;
    }

    /**
     * Close payment history modal
     */
    closePaymentHistory() {
        this.showPaymentHistoryModal = false;
    }

    /**
     * Handle modal click (prevent closing when clicking inside modal)
     */
    handleModalClick(event) {
        event.stopPropagation();
    }

    /**
     * Download invoice PDF
     */
    handleDownloadInvoice(event) {
        const button = event.currentTarget;
        const invoiceId = button.dataset.invoiceId;
        const paymentId = button.dataset.paymentId;

        console.log('Download clicked - Invoice ID:', invoiceId, 'Payment ID:', paymentId);

        if (!invoiceId) {
            console.error('Invoice ID is null or undefined', {
                invoiceId,
                paymentId,
                buttonDataset: button.dataset
            });
            this.showToast('Error', 'Invoice reference not found. Please verify the payment record.', 'error');
            return;
        }

        try {
            // Open the Visualforce page with both invoice ID and payment ID parameters
            let vfPageUrl = `/apex/InvoicePaymentPage?invoiceId=${invoiceId}`;
            if (paymentId) {
                vfPageUrl += `&paymentId=${paymentId}`;
            }
            console.log('Opening VF page:', vfPageUrl);
            window.open(vfPageUrl, '_blank');
            this.showToast('Success', 'Invoice PDF is being generated', 'success');
        } catch (error) {
            console.error('Error downloading invoice:', error);
            this.showToast('Error', 'Failed to download invoice: ' + error.message, 'error');
        }
    }

    /**
     * Check if payment is complete (outstanding amount is zero)
     */
    get isPaymentComplete() {
        return this.hasInvoiceData && this.outstandingAmount <= 0;
    }

    /**
     * Check if payment methods should be shown
     */
    get showPaymentMethods() {
        return this.hasInvoiceData && !this.isPaymentComplete;
    }

    /**
     * Get the appropriate transaction reference based on payment mode
     */
    getTransactionReference(payment) {
        if (!payment) {
            return '';
        }

        switch (payment.AMERP_Payment_Mode__c) {
            case 'UPI':
                return payment.AMERP_UPI_Reference_Numbe__c || '-';
            case 'Card':
                return payment.AMERP_Transaction_Id__c || '-';
            case 'Bank Transfer':
                return payment.AMERP_Transaction_Reference__c || '-';
            case 'Cash':
                return payment.AMERP_Cash_Receipt_Number__c || '-';
            default:
                return '-';
        }
    }

    /**
     * Check if payment history is empty
     */
    get isEmptyPaymentHistory() {
        return !this.paymentHistory || this.paymentHistory.length === 0;
    }
}