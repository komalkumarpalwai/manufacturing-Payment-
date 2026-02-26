public with sharing class InvoicePaymentController {
    
    public AMERP_Custom_Invoice__c invoice { get; set; }
    public AMERP_Invoice_Payment__c latestPayment { get; set; }
    public String errorMessage { get; set; }
    
    // Customer details
    public String customerName    { get; set; }
    public String customerAddress { get; set; }
    public String customerCity    { get; set; }
    public String customerPhone   { get; set; }
    public String customerEmail   { get; set; }
    public String customerGST     { get; set; }
    
    // Order number (human-readable, not the Salesforce ID)
    public String orderNumber     { get; set; }
    
    // Amounts for summary
    public Decimal amountPaid { get; set; }
    public Decimal balanceDue { get; set; }
    
    // ─────────────────────────────────────────────────────────────────
    // CONSTRUCTOR — unchanged logic, added orderNumber population
    // ─────────────────────────────────────────────────────────────────
    public InvoicePaymentController() {
        try {
            // Get invoiceId from URL parameters
            String invoiceId = ApexPages.currentPage().getParameters().get('invoiceId');
            
            // Handle null or empty invoiceId
            if (String.isBlank(invoiceId)) {
                errorMessage = 'Invoice ID is required to generate payment receipt.';
                return;
            }
            
            // Query invoice record with customer details
            // NOTE: Added AMERP_Order__r.Name so we get the readable order number
            List<AMERP_Custom_Invoice__c> invoices = [
                SELECT Id, 
                       Name, 
                       AMERP_Total_Amount__c, 
                       AMERP_Invoice_Amount__c, 
                       AMERP_Invoice_Date__c, 
                       AMERP_Due_Date__c, 
                       AMERP_Total_Paid_Amount__c, 
                       AMERP_Outstanding_Amount__c,
                       AMERP_Payment_Status__c,
                       AMERP_Customer__c, 
                       AMERP_Customer__r.Name,
                       AMERP_Order__c,
                       AMERP_Order__r.OrderNumber           // ← fetch the order name/number
                FROM AMERP_Custom_Invoice__c
                WHERE Id = :invoiceId
                LIMIT 1
            ];
            
            if (invoices.isEmpty()) {
                errorMessage = 'Invoice not found.';
                return;
            }
            
            invoice = invoices[0];
            
            // Populate readable order number
            // Falls back gracefully if no order is linked
            if (invoice.AMERP_Order__c != null) {
                orderNumber = invoice.AMERP_Order__r.OrderNumber;
            } else {
                orderNumber = '—';
            }
            
            // Set customer details
            if (invoice.AMERP_Customer__c != null) {
                List<Account> customers = [
                    SELECT Id, 
                           Name, 
                           BillingStreet, 
                           BillingCity, 
                           BillingPostalCode, 
                           BillingCountry, 
                           Phone, 
                           AMERP_Email__c, 
                           AMERP_GST_VAT_Number__c
                    FROM Account
                    WHERE Id = :invoice.AMERP_Customer__c
                    LIMIT 1
                ];
                
                if (!customers.isEmpty()) {
                    Account customer = customers[0];
                    customerName    = customer.Name;
                    customerAddress = customer.BillingStreet    != null ? customer.BillingStreet    : '';
                    customerCity    = (customer.BillingCity     != null ? customer.BillingCity       : '') + 
                                     (customer.BillingPostalCode != null ? ', ' + customer.BillingPostalCode : '') + 
                                     (customer.BillingCountry   != null ? ', ' + customer.BillingCountry   : '');
                    customerPhone   = customer.Phone            != null ? customer.Phone            : '';
                    customerEmail   = customer.AMERP_Email__c   != null ? customer.AMERP_Email__c   : '';
                    customerGST     = customer.AMERP_GST_VAT_Number__c != null ? customer.AMERP_GST_VAT_Number__c : '';
                }
            }
            
            // Query latest successful payment for this invoice
            List<AMERP_Invoice_Payment__c> payments = [
                SELECT Id, 
                       Name,
                       AMERP_Invoice__c,
                       AMERP_Payment_Amount__c,
                       AMERP_Payment_Date__c,
                       AMERP_Payment_Mode__c,
                       AMERP_Payment_Status__c,
                       AMERP_Transaction_Reference__c
                FROM AMERP_Invoice_Payment__c
                WHERE AMERP_Invoice__c = :invoiceId 
                AND   AMERP_Payment_Status__c IN ('Received', 'Successful')
                ORDER BY AMERP_Payment_Date__c DESC
                LIMIT 1
            ];
            
            if (!payments.isEmpty()) {
                latestPayment = payments[0];
            }
            
            // Calculate amounts paid and balance due
            amountPaid = invoice.AMERP_Total_Paid_Amount__c    != null ? invoice.AMERP_Total_Paid_Amount__c    : 0;
            balanceDue = invoice.AMERP_Outstanding_Amount__c   != null ? invoice.AMERP_Outstanding_Amount__c   : 0;
            
        } catch (Exception e) {
            errorMessage = 'Error loading payment information: ' + e.getMessage();
        }
    }
    
    // ─────────────────────────────────────────────────────────────────
    // GENERATE & SAVE RECEIPT
    // Renders InvoicePaymentPage as PDF → saves to Salesforce Files
    // → links to the Invoice record → opens PDF in browser
    // ─────────────────────────────────────────────────────────────────
    public PageReference generateAndSaveReceipt() {
        
        // Guard: invoice must be loaded before we can proceed
        if (invoice == null || invoice.Id == null) {
            errorMessage = 'Cannot generate receipt: Invoice not loaded.';
            return null;
        }
        
        try {
            // ── STEP 1: Point to the PDF VF page ─────────────────────
            // Make sure 'InvoicePaymentPage' matches your VF page API name
            // in Setup → Visualforce Pages exactly (case-sensitive)
            PageReference pdfPage = Page.InvoicePaymentPage;
            pdfPage.getParameters().put('invoiceId', invoice.Id);
            
            Blob pdfBlob;
            if (Test.isRunningTest()) {
                // getContentAsPDF() cannot run in test context
                pdfBlob = Blob.valueOf('MOCK_PDF_FOR_UNIT_TEST');
            } else {
                pdfBlob = pdfPage.getContentAsPDF();
            }
            
            // ── STEP 2: Build a descriptive, unique file name ─────────
            String paymentRef = (latestPayment != null) 
                                ? latestPayment.Name 
                                : 'NoPmt';
            String datePart   = System.today().format()
                                             .replace('/', '-');   // e.g. 26-02-2026
            String fileName   = 'Payment_Receipt_'
                              + invoice.Name + '_'
                              + paymentRef   + '_'
                              + datePart     + '.pdf';
            
            // ── STEP 3: Create ContentVersion (the actual stored file) 
            ContentVersion cv    = new ContentVersion();
            cv.Title             = fileName;
            cv.PathOnClient      = fileName;
            cv.VersionData       = pdfBlob;
            cv.IsMajorVersion    = true;
            cv.ContentLocation   = 'S';   // 'S' = Salesforce (not external)
            insert cv;
            
            // ── STEP 4: Retrieve the auto-generated ContentDocumentId ─
            ContentVersion inserted = [
                SELECT ContentDocumentId
                FROM   ContentVersion
                WHERE  Id = :cv.Id
                LIMIT  1
            ];
            
            // ── STEP 5: Link file to the Invoice record ───────────────
            // Guard against duplicate link if the same doc was somehow
            // linked already (re-run scenario)
            List<ContentDocumentLink> existingLinks = [
                SELECT Id
                FROM   ContentDocumentLink
                WHERE  ContentDocumentId = :inserted.ContentDocumentId
                AND    LinkedEntityId    = :invoice.Id
                LIMIT  1
            ];
            
            if (existingLinks.isEmpty()) {
                ContentDocumentLink cdl = new ContentDocumentLink();
                cdl.ContentDocumentId   = inserted.ContentDocumentId;
                cdl.LinkedEntityId      = invoice.Id;   // ← links to Invoice
                cdl.ShareType           = 'V';          // V=Viewer, C=Collaborator
                cdl.Visibility          = 'AllUsers';
                insert cdl;
            }
            
            // ── STEP 6: Open the PDF in the browser ───────────────────
            PageReference download = new PageReference(
                '/sfc/servlet.shepherd/document/download/'
                + inserted.ContentDocumentId
            );
            download.setRedirect(true);
            return download;
            
        } catch (Exception e) {
            errorMessage = 'Error generating receipt: ' + e.getMessage();
            return null;
        }
    }
    
    // ─────────────────────────────────────────────────────────────────
    // NAVIGATE BACK — existing method, unchanged
    // ─────────────────────────────────────────────────────────────────
    public PageReference navigateToInvoice() {
        if (invoice != null && invoice.Id != null) {
            return new PageReference('/' + invoice.Id);
        }
        return null;
    }
}