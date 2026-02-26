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

    // Dynamic field templates based on payment mode
    paymentModeFields = {
        'Cash': [
            { name: 'cashReceivedBy', label: 'Cash Received By', type: 'text', required: true }
        ],
        'UPI': [
            { name: 'upiAppName', label: 'UPI App Name', type: 'text', required: true },
            { name: 'upiId', label: 'UPI ID', type: 'text', required: true }
        ],
        'Card': [
            { name: 'cardHolderName', label: 'Card Holder Name', type: 'text', required: true },
            { name: 'cardNumber', label: 'Card Number', type: 'text', required: true },
            { name: 'cardType', label: 'Card Type', type: 'combobox', required: true }
        ],
        'Bank Transfer': [
            { name: 'bankName', label: 'Bank Name', type: 'text', required: true },
            { name: 'ifscCode', label: 'IFSC Code', type: 'text', required: true }
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
     * Generate Transaction ID with mode-specific prefix
     */
    generateTransactionId(mode) {
        const uniqueId = this.generateUniqueId();
        
        switch(mode) {
            case 'UPI':
                return `UPI-${uniqueId}`;
            case 'Card':
                const cardType = this.formFields.cardType || 'CARD';
                return `${cardType}-${uniqueId}`;
            case 'Bank Transfer':
                const bankName = (this.formFields.bankName || 'BANK').substring(0, 4).toUpperCase();
                return `${bankName}-${uniqueId}`;
            case 'Cash':
                return `CASH-${uniqueId}`;
            default:
                return `TXN-${uniqueId}`;
        }
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
            const transactionId = this.generateTransactionId(this.selectedPaymentMode);
            
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
                
                // Refresh invoice data
                await refreshApex(this.wiredInvoiceResult);
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
     * Check if the field is card type field
     */
    isCardTypeField(fieldName) {
        return fieldName === 'cardType';
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
            // Open the Visualforce page with the invoice ID parameter
            const vfPageUrl = `/apex/InvoicePaymentPage?invoiceId=${invoiceId}`;
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