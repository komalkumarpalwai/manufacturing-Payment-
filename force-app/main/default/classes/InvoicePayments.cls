public with sharing class InvoicePayments {
    
    /**
     * Wrapper class for Invoice Payment data
     * Contains all fields required for creating AMERP_Invoice_Payment__c records
     */
    public class InvoicePaymentWrapper {
        
        @AuraEnabled
        public Decimal paymentAmount { get; set; }
        
        @AuraEnabled
        public Date paymentDate { get; set; }
        
        @AuraEnabled
        public String paymentMode { get; set; }
        
        @AuraEnabled
        public String paymentType { get; set; }
        
        @AuraEnabled
        public String paymentStatus { get; set; }
        
        @AuraEnabled
        public String paymentNote { get; set; }
        
        @AuraEnabled
        public Id invoiceId { get; set; }
        
        @AuraEnabled
        public Id customerId { get; set; }
        
        // Cash Payment Fields
        @AuraEnabled
        public String cashReceivedBy { get; set; }
        
        @AuraEnabled
        public String cashReceiptNumber { get; set; }
        
        // UPI Payment Fields
        @AuraEnabled
        public String upiAppName { get; set; }
        
        @AuraEnabled
        public String upiId { get; set; }
        
        @AuraEnabled
        public String upiReferenceNumber { get; set; }
        
        // Card Payment Fields
        @AuraEnabled
        public String cardHolderName { get; set; }
        
        @AuraEnabled
        public String cardNumber { get; set; }
        
        @AuraEnabled
        public String cardType { get; set; }
        
        @AuraEnabled
        public String transactionId { get; set; }
        
        // Bank Transfer Fields
        @AuraEnabled
        public String bankName { get; set; }
        
        @AuraEnabled
        public String ifscCode { get; set; }
        
        @AuraEnabled
        public String transferReferenceNumber { get; set; }
        
        @AuraEnabled
        public String transactionReference { get; set; }
        
        /**
         * Constructor
         */
        public InvoicePaymentWrapper() {
            this.paymentStatus = 'Received';
            this.paymentDate = System.today();
        }
    }
    
    /**
     * Fetches invoice details from AMERP_Custom_Invoice__c object
     * @param invoiceId The record Id of the invoice
     * @return AMERP_Custom_Invoice__c record with selected fields
     */
    @AuraEnabled(cacheable=true)
    public static AMERP_Custom_Invoice__c getInvoiceDetails(Id invoiceId) {
        try {
            // Validate input
            if (invoiceId == null) {
                throw new IllegalArgumentException('Invoice ID cannot be null');
            }

            // Query invoice with security enforcement
            AMERP_Custom_Invoice__c invoice = [
                SELECT 
                    Id,
                    Balance_Amount__c,
                    Contact__c,
                    CreatedById,
                    CurrencyIsoCode,
                    AMERP_Customer__c,
                    AMERP_Due_Date__c,
                    AMERP_GRN__c,
                    AMERP_Invoice_Amount__c,
                    AMERP_Invoice_Date__c,
                    Name,
                    LastModifiedById,
                    AMERP_Order__c,
                    AMERP_Outstanding_Amount__c,
                    OwnerId,
                    AMERP_Payment_Status__c,
                    AMERP_Purchase_Order__c,
                    RecordTypeId,
                    AMERP_Remarks__c,
                    Reminder_5_Sent__c,
                    Reminder_7_Sent__c,
                    Reminder_Due_Sent__c,
                    AMERP_Site__c,
                    AMERP_Status__c,
                    AMERP_Total_Amount__c,
                    AMERP_Total_Paid_Amount__c,
                    AMERP_Vendor__c
                FROM AMERP_Custom_Invoice__c
                WHERE Id = :invoiceId
                WITH SECURITY_ENFORCED
                LIMIT 1
            ];

            if (invoice == null) {
                throw new QueryException('Invoice record not found with Id: ' + invoiceId);
            }

            return invoice;
        } catch (QueryException qe) {
            throw new AuraHandledException('Error fetching invoice: ' + qe.getMessage());
        } catch (System.NoAccessException nae) {
            throw new AuraHandledException('You do not have permission to access the invoice record');
        } catch (Exception e) {
            throw new AuraHandledException('An error occurred while fetching invoice details: ' + e.getMessage());
        }
    }

    /**
     * Creates a new invoice payment record
     * @param wrapper InvoicePaymentWrapper containing payment details
     * @return Id of the created payment record
     */
    @AuraEnabled
    public static Id createInvoicePayment(InvoicePaymentWrapper wrapper) {
        try {
            // Validate required fields
            validatePaymentWrapper(wrapper);

            // Create new payment record
            AMERP_Invoice_Payment__c payment = new AMERP_Invoice_Payment__c();
            
            // Set common fields
            payment.AMERP_Invoice__c = wrapper.invoiceId;
            payment.AMERP_Customer__c = wrapper.customerId;
            payment.AMERP_Payment_Amount__c = wrapper.paymentAmount;
            payment.AMERP_Payment_Date__c = wrapper.paymentDate ?? System.today();
            payment.AMERP_Payment_Mode__c = wrapper.paymentMode;
            payment.AMERP_Payment_Status__c = wrapper.paymentStatus ?? 'Received';
            payment.AMERP_PAYMENT_NOTE__c = wrapper.paymentNote;

            // Map fields based on payment mode
            switch on wrapper.paymentMode {
                when 'Cash' {
                    payment.AMERP_Cash_Received_By__c = wrapper.cashReceivedBy;
                    payment.AMERP_Cash_Receipt_Number__c = wrapper.cashReceiptNumber;
                }
                when 'UPI' {
                    payment.AMERP_UPI_App_Name__c = wrapper.upiAppName;
                    payment.AMERP_UPI_Id__c = wrapper.upiId;
                }
                when 'Card' {
                    payment.AMERP_Card_Holder_Name__c = wrapper.cardHolderName;
                    payment.AMERP_Card_Number__c = wrapper.cardNumber;
                    payment.AMERP_Card_Type__c = wrapper.cardType;
                }
                when 'Bank Transfer' {
                    payment.AMERP_Bank_Name__c = wrapper.bankName;
                    payment.AMERP_IFSC_Code__c = wrapper.ifscCode;
                }
            }

            // Insert record with security enforcement
            // Note: Use DML with security check
            if (!Schema.sObjectType.AMERP_Invoice_Payment__c.isCreateable()) {
                throw new AuraHandledException('You do not have permission to create payment records');
            }

            insert payment;

            // Generate unique transaction reference based on payment mode and record Id
            String transactionReference = generateTransactionReference(payment.Id, wrapper.paymentMode, wrapper);
            
            // Update payment record with generated transaction reference
            payment = updatePaymentWithTransactionRef(payment.Id, transactionReference, wrapper.paymentMode);

            return payment.Id;
        } catch (System.NoAccessException nae) {
            throw new AuraHandledException('You do not have permission to create payment records: ' + nae.getMessage());
        } catch (DmlException dme) {
            throw new AuraHandledException('Error creating payment record: ' + dme.getMessage());
        } catch (Exception e) {
            throw new AuraHandledException('An error occurred while creating payment: ' + e.getMessage());
        }
    }

    /**
     * Generates a unique transaction reference based on payment mode
     * @param recordId The Id of the payment record
     * @param paymentMode The payment mode (UPI, Card, Bank Transfer, Cash)
     * @param wrapper The payment wrapper containing payment details
     * @return Unique transaction reference with appropriate prefix
     */
    private static String generateTransactionReference(Id recordId, String paymentMode, InvoicePaymentWrapper wrapper) {
        String prefix = '';
        
        switch on paymentMode {
            when 'UPI' {
                prefix = 'UPI-';
            }
            when 'Card' {
                prefix = 'Card-';
            }
            when 'Bank Transfer' {
                prefix = wrapper.bankName + '-';
            }
            when 'Cash' {
                prefix = 'Cash-';
            }
            when else {
                prefix = 'TXN-';
            }
        }
        
        // Use the record Id as the unique identifier
        return prefix + recordId;
    }

    /**
     * Updates payment record with generated transaction reference
     * @param paymentId The Id of the payment record
     * @param transactionReference The generated transaction reference
     * @param paymentMode The payment mode
     * @return Updated AMERP_Invoice_Payment__c record
     */
    private static AMERP_Invoice_Payment__c updatePaymentWithTransactionRef(Id paymentId, String transactionReference, String paymentMode) {
        AMERP_Invoice_Payment__c payment = new AMERP_Invoice_Payment__c(Id = paymentId);
        
        // Store transaction reference in the appropriate field based on payment mode
        switch on paymentMode {
            when 'UPI' {
                payment.AMERP_UPI_Reference_Numbe__c = transactionReference;
            }
            when 'Card' {
                payment.AMERP_Transaction_Id__c = transactionReference;
            }
            when 'Bank Transfer' {
                payment.AMERP_Transaction_Reference__c = transactionReference;
            }
            when 'Cash' {
                payment.AMERP_Transaction_Id__c = transactionReference;
            }
        }
        
        if (Schema.sObjectType.AMERP_Invoice_Payment__c.isUpdateable()) {
            update payment;
        }
        
        return payment;
    }

    /**
     * Validates the payment wrapper for required fields
     * @param wrapper InvoicePaymentWrapper to validate
     */
    private static void validatePaymentWrapper(InvoicePaymentWrapper wrapper) {
        if (wrapper == null) {
            throw new IllegalArgumentException('Payment wrapper cannot be null');
        }
        if (wrapper.invoiceId == null) {
            throw new IllegalArgumentException('Invoice ID is required');
        }
        if (wrapper.customerId == null) {
            throw new IllegalArgumentException('Customer ID is required');
        }
        if (wrapper.paymentAmount == null || wrapper.paymentAmount <= 0) {
            throw new IllegalArgumentException('Payment amount must be greater than zero');
        }
        if (String.isBlank(wrapper.paymentMode)) {
            throw new IllegalArgumentException('Payment mode is required');
        }

        // Validate based on payment mode
        switch on wrapper.paymentMode {
            when 'Cash' {
                if (String.isBlank(wrapper.cashReceivedBy)) {
                    throw new IllegalArgumentException('Cash Received By is required for Cash payments');
                }
                if (String.isBlank(wrapper.cashReceiptNumber)) {
                    throw new IllegalArgumentException('Cash Receipt Number is required for Cash payments');
                }
            }
            when 'UPI' {
                if (String.isBlank(wrapper.upiAppName)) {
                    throw new IllegalArgumentException('UPI App Name is required for UPI payments');
                }
                if (String.isBlank(wrapper.upiId)) {
                    throw new IllegalArgumentException('UPI ID is required for UPI payments');
                }
            }
            when 'Card' {
                if (String.isBlank(wrapper.cardHolderName)) {
                    throw new IllegalArgumentException('Card Holder Name is required for Card payments');
                }
                if (String.isBlank(wrapper.cardNumber)) {
                    throw new IllegalArgumentException('Card Number is required for Card payments');
                }
                if (String.isBlank(wrapper.cardType)) {
                    throw new IllegalArgumentException('Card Type is required for Card payments');
                }
            }
            when 'Bank Transfer' {
                if (String.isBlank(wrapper.bankName)) {
                    throw new IllegalArgumentException('Bank Name is required for Bank Transfer payments');
                }
                if (String.isBlank(wrapper.ifscCode)) {
                    throw new IllegalArgumentException('IFSC Code is required for Bank Transfer payments');
                }
            }
        }
    }

    /**
     * Fetches payment history for an invoice
     * @param invoiceId The record Id of the invoice
     * @return List of AMERP_Invoice_Payment__c records
     */
    @AuraEnabled(cacheable=true)
    public static List<AMERP_Invoice_Payment__c> getPaymentHistory(Id invoiceId) {
        try {
            if (invoiceId == null) {
                return new List<AMERP_Invoice_Payment__c>();
            }

            if (!Schema.sObjectType.AMERP_Invoice_Payment__c.isAccessible()) {
                throw new AuraHandledException('You do not have access to Payment records');
            }

            return [
                SELECT 
                    Id,
                    AMERP_Invoice__c,
                    AMERP_Payment_Date__c,
                    AMERP_Payment_Mode__c,
                    AMERP_Payment_Amount__c,
                    AMERP_Payment_Status__c,
                    AMERP_UPI_Reference_Numbe__c,
                    AMERP_Transaction_Id__c,
                    AMERP_Transaction_Reference__c,
                    AMERP_Cash_Receipt_Number__c,
                    CreatedDate
                FROM AMERP_Invoice_Payment__c
                WHERE AMERP_Invoice__c = :invoiceId 
                AND AMERP_Payment_Status__c != null
                ORDER BY CreatedDate DESC
                LIMIT 100
            ];
        } catch (Exception e) {
            throw new AuraHandledException('Error fetching payment history: ' + e.getMessage());
        }
    }
}