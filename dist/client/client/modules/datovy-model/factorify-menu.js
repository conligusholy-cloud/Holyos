/* ============================================
   factorify-menu.ts — Exact Factorify navigation structure
   Scraped from bs.factorify.cloud/ui/
   Entity names verified against /api/metadata/entities
   ============================================ */
// Top-level items (no category)
export const TOP_ITEMS = [
    { label: 'Denní report', slug: 'daily-report', entityName: '' }, // UI-only view
    { label: 'Workspace', slug: 'workspace', entityName: '' },
];
// Full navigation structure matching Factorify exactly
// entityName verified against API metadata; '' = UI-only view (no queryable entity)
export const MENU = [
    {
        name: 'PRODEJ',
        items: [
            { label: 'Dodací listy', slug: 'delivery-bill', entityName: 'DeliveryBill' },
            { label: 'Nabídky', slug: 'offer', entityName: 'Offer' },
            { label: 'Palety', slug: 'pallet', entityName: 'Pallet' },
            { label: 'Plán expedice', slug: 'planned-dispatch', entityName: 'MDSPlannedDispatch' },
            { label: 'Prodejní ceníky', slug: 'selling-price-list', entityName: 'SellingPriceList' },
            { label: 'Prodejní objednávky', slug: 'sales-order', entityName: 'SalesOrder' },
            { label: 'Rámcové prodejní obj.', slug: 'framework-sales-order', entityName: 'FrameworkSalesOrder' },
        ],
    },
    {
        name: 'NÁKUP',
        items: [
            { label: 'Nákupní ceníky', slug: 'buying-price-list', entityName: 'BuyingPriceList' },
            { label: 'Nákupní objednávky', slug: 'purchase-order', entityName: 'PurchaseOrder' },
            { label: 'Rámcové nákupní obj.', slug: 'framework-purchase-order', entityName: 'FrameworkPurchaseOrder' },
            { label: 'Textové objednávky', slug: 'text-order', entityName: 'TextOrder' },
            { label: 'Výhled nákupů', slug: 'order-prediction', entityName: 'MDSPlannedDelivery' },
        ],
    },
    {
        name: 'KOOPERACE',
        items: [
            { label: 'Kooperační ceníky', slug: 'cooperation-price-list', entityName: 'CooperationPriceList' },
            { label: 'Kooperační objednávky', slug: 'cooperation-order', entityName: 'CooperationOrder' },
            { label: 'Kooperační plán', slug: 'cooperation-plan', entityName: 'MDSCooperationBatch' },
            { label: 'Naplánované koop. obj.', slug: 'mds-planned-cooperation-order', entityName: 'MDSPlannedCooperationOrder' },
        ],
    },
    {
        name: 'CRM',
        items: [
            { label: 'Adresy', slug: 'address', entityName: 'Address' },
            { label: 'Historie komunikace', slug: 'communication-history', entityName: 'CommunicationHistory' },
            { label: 'Hodnocení dodavatelů', slug: 'supplier-performance-review', entityName: 'SupplierPerformanceReview' },
            { label: 'Lidé', slug: 'person', entityName: 'Person' },
            { label: 'Obchodní příležitosti', slug: 'opportunity', entityName: 'Opportunity' },
            { label: 'Přijaté emaily', slug: 'received-email', entityName: 'ReceivedEmail' },
            { label: 'Skupiny společností', slug: 'company-group', entityName: 'CompanyGroup' },
            { label: 'Společnosti', slug: 'company', entityName: 'Company' },
            { label: 'Výpadky společnosti', slug: 'company-outage', entityName: 'CompanyOutage' },
        ],
    },
    {
        name: 'DOCHÁZKA',
        items: [
            { label: 'Denní plán směn', slug: 'daily-shift-plan', entityName: '' }, // UI-only view
            { label: 'Docházka - směny', slug: 'assigned-shift', entityName: 'AssignedShift' },
            { label: 'Lidé v práci', slug: 'people-at-work', entityName: '' }, // UI-only view
            { label: 'Náhrady', slug: 'absence-compensation', entityName: 'MDSCompensation' },
            { label: 'Nepřítomnost', slug: 'absence', entityName: 'Absence' },
            { label: 'Převody přesčasů', slug: 'overtime-transfer', entityName: 'OvertimeTransfer' },
            { label: 'Služební cesty', slug: 'business-trip', entityName: 'BusinessTrip' },
            { label: 'Týdenní plán směn', slug: 'weekly-shift-plan', entityName: '' }, // UI-only view
            { label: 'Výkazy docházky', slug: 'attendance-report', entityName: 'AttendanceStatement' },
        ],
    },
    {
        name: 'DOKUMENTY',
        items: [
            { label: 'Úložiště dokumentů', slug: 'document-vault', entityName: 'DocumentsStorage' },
        ],
    },
    {
        name: 'EKONOMIKA',
        items: [
            { label: 'Analýza nákladů', slug: 'eco-cost-analysis', entityName: '' }, // UI-only view
            { label: 'Kalkulace', slug: 'eco-calculation', entityName: 'GoodsCalculation' },
            { label: 'Náklady na projekty', slug: 'eco-project-cost', entityName: 'ValueInProject' },
            { label: 'Nakupované skladem', slug: 'eco-purchased-stock', entityName: 'PurchasedStockItem' },
            { label: 'Nedokončená výroba', slug: 'eco-work-in-progress', entityName: 'ValueInProduction' },
            { label: 'Oceněné skl. pohyby', slug: 'eco-valued-stock-movement', entityName: '' }, // UI-only view
            { label: 'Vyráběné skladem', slug: 'eco-manufactured-stock', entityName: 'ProducedStockItem' },
            { label: 'Záznamy nákladů', slug: 'eco-cost-record', entityName: 'CostRecord' },
        ],
    },
    {
        name: 'HR',
        items: [
            { label: 'eDávky', slug: 'e-benefit', entityName: 'PersonContractSocialBenefit' },
            { label: 'eNeschopenky', slug: 'e-sick-leave', entityName: 'PersonContractSickNote' },
            { label: 'Hodnocení zaměstnanců', slug: 'employee-review', entityName: 'PerformanceReview' },
            { label: 'Mzdová mapa', slug: 'salary-map', entityName: '' }, // UI-only view
            { label: 'Mzdové výměry', slug: 'salary-assessment', entityName: 'SalaryAssessment' },
            { label: 'Odesílání formulářů', slug: 'form-submission', entityName: 'FormSubmission' },
            { label: 'Odměny/srážky', slug: 'bonuses-penalties', entityName: 'BonusesPenalties' },
            { label: 'Organizační struktura', slug: 'organization-chart', entityName: '' }, // UI-only view
            { label: 'Pracovní smlouvy', slug: 'person-contract', entityName: 'PersonContract' },
            { label: 'Školení', slug: 'training', entityName: 'Training' },
            { label: 'Úrazy', slug: 'injury', entityName: 'Injury' },
            { label: 'Zaměstnanci', slug: 'employee', entityName: 'Employee' },
            { label: 'Záznamy školení', slug: 'training-record', entityName: 'TrainingRecord' },
            { label: 'Zbývající nepřít.', slug: 'mds-remaining-absence', entityName: 'MDSRemainingAbsence' },
            { label: 'Zprávy', slug: 'message', entityName: 'Message' },
        ],
    },
    {
        name: 'JÍDELNÍ MENU',
        items: [
            { label: 'Editor jídelního menu', slug: 'meal-menu-editor', entityName: '' }, // UI-only view
        ],
    },
    {
        name: 'NORMY',
        items: [
            { label: 'Denní efektivita práce', slug: 'daily-labor-effectiveness', entityName: '' }, // UI-only view
            { label: 'Efektivita práce', slug: 'overall-labor-effectiveness', entityName: 'MDSWorkerEffectiveness' },
            { label: 'Historie časů norem', slug: 'standard-time-history', entityName: 'OperationTimesHistory' },
            { label: 'Normy', slug: 'standard-time', entityName: 'StandardTimesView' },
        ],
    },
    {
        name: 'PLÁNOVÁNÍ',
        items: [
            { label: 'Čekající pracovníci', slug: 'waiting-worker', entityName: '' }, // UI-only view
            { label: 'Denní plán výroby', slug: 'daily-production-plan', entityName: '' }, // UI-only view
            { label: 'Ganttův diagram', slug: 'gantt-chart', entityName: '' }, // UI-only view
            { label: 'Kapacitní plán', slug: 'capacity-plan', entityName: '' }, // UI-only view
            { label: 'Plánování', slug: 'planning', entityName: '' }, // UI-only view
            { label: 'Strategický plán', slug: 'strategic-plan', entityName: 'StrategicPlanEntity' },
            { label: 'Výrobní linky', slug: 'production-line', entityName: '' }, // UI-only view
        ],
    },
    {
        name: 'SKLAD',
        items: [
            { label: 'Inventury', slug: 'stock-taking', entityName: 'StockPhysicalInventory' },
            { label: 'Kusovníky', slug: 'bom', entityName: 'Bom' },
            { label: 'Min. zásoby', slug: 'minimal-stock', entityName: '' }, // UI-only view
            { label: 'Nesting', slug: 'nesting', entityName: 'Nesting' },
            { label: 'Pozice skladu', slug: 'stock-position', entityName: '' }, // UI-only view
            { label: 'Sklady', slug: 'warehouse', entityName: 'StockSqlEntity' },
            { label: 'Skladové pohyby', slug: 'stock-document', entityName: 'StockDocument' },
            { label: 'Skladové položky', slug: 'stock-items', entityName: 'StockItem' },
            { label: 'Spotřeba mat. na prac.', slug: 'material-consumption-on-stages', entityName: '' }, // UI-only view
            { label: 'Tisk štítků', slug: 'print-labels', entityName: '' }, // UI-only view
            { label: 'Záměna skl. zásob', slug: 'stock-supply-substitution', entityName: '' }, // UI-only view
        ],
    },
    {
        name: 'ÚČETNICTVÍ',
        items: [
            { label: 'Bankovní výpisy', slug: 'bank-statement', entityName: 'BankStatement' },
            { label: 'Časová rozlišení', slug: 'accrual', entityName: 'Accrual' },
            { label: 'Dlouhodobý majetek', slug: 'long-term-asset', entityName: 'LongTermAsset' },
            { label: 'Intrastat', slug: 'intrastat-report', entityName: 'IntrastatReport' },
            { label: 'Kontrolní součty', slug: 'control-sum-result', entityName: 'ControlSumResult' },
            { label: 'Kontrolní součty plateb', slug: 'control-sum-payment', entityName: 'ControlSumPayment' },
            { label: 'Manažerské výkazy', slug: 'cash-flow', entityName: '' }, // UI-only view
            { label: 'Mzdy', slug: 'payrolls', entityName: 'Payrolls' },
            { label: 'Nahrané doklady', slug: 'submitted-document', entityName: 'SubmittedDocument' },
            { label: 'Obratová předvaha', slug: 'trial-balance', entityName: 'Report20002' },
            { label: 'Platby', slug: 'payment', entityName: 'Payment' },
            { label: 'Platební příkazy', slug: 'payment-order', entityName: 'PaymentOrder' },
            { label: 'Pohyby na účtu', slug: 'accounting-moves-view', entityName: 'AccountingMovesView' },
            { label: 'Roční zúčtování', slug: 'annual-tax-settlement', entityName: 'AnnualTaxSettlement' },
            { label: 'Rozvaha', slug: 'balance-sheet', entityName: 'Report20003' },
            { label: 'Saldo', slug: 'transaction-balance', entityName: 'TransactionBalance' },
            { label: 'Účetní deník', slug: 'accounting-transaction-v', entityName: 'AccountingTransactionV' },
            { label: 'Účetní doklady', slug: 'accounting-document', entityName: 'AccountingDocument' },
            { label: 'Účetní tiskové sestavy', slug: 'accounting-reports', entityName: '' }, // UI-only view
            { label: 'Výkaz zisku a ztráty', slug: 'income-statement', entityName: 'Report20004' },
            { label: 'Vypořádání', slug: 'accounting-reconciliation', entityName: 'AccountingReconciliation' },
            { label: 'Zpracování DPH', slug: 'vat-processing', entityName: 'VatProcessing' },
        ],
    },
    {
        name: 'ÚKOLY',
        items: [
            { label: 'Procesy (BPM)', slug: 'process', entityName: 'ProcessExecution' },
            { label: 'Projekty', slug: 'project', entityName: 'Project' },
            { label: 'Stav procesů (BPM)', slug: 'process-state', entityName: '' }, // UI-only view
            { label: 'Úkoly', slug: 'task', entityName: 'Task' },
            { label: 'Záznamy práce', slug: 'task-work-log', entityName: 'TaskWorkLog' },
        ],
    },
    {
        name: 'ZDROJE',
        items: [
            { label: 'Import zboží z archivu', slug: 'import-goods-archive', entityName: '' }, // UI-only view
            { label: 'Importovat zboží', slug: 'import-goods', entityName: '' }, // UI-only view
            { label: 'Nástroje', slug: 'tool', entityName: 'Tool' },
            { label: 'Opravy', slug: 'repairs', entityName: 'Repairs' },
            { label: 'Přesuny nástrojů', slug: 'mds-planned-tool-move', entityName: 'MDSPlannedToolMove' },
            { label: 'Stroje', slug: 'machine', entityName: 'Machine' },
            { label: 'Šablony zboží', slug: 'goods-template', entityName: 'GoodsTemplate' },
            { label: 'Typy nástrojů', slug: 'tool-type', entityName: 'ToolType' },
            { label: 'Typy strojů', slug: 'machine-type', entityName: 'MachineType' },
            { label: 'Výpadky nástrojů', slug: 'tool-outage', entityName: 'ToolOutage' },
            { label: 'Výpadky strojů', slug: 'machine-outage', entityName: 'MachineOutage' },
            { label: 'Zboží', slug: 'goods', entityName: 'Goods' },
        ],
    },
    {
        name: 'VÝROBA',
        items: [
            { label: 'Aktivity', slug: 'activity', entityName: 'Activity' },
            { label: 'Dávky', slug: 'batch', entityName: 'Batch' },
            { label: 'Efektivita strojů', slug: 'machines-effectivity', entityName: '' }, // UI-only view
            { label: 'Fronta práce', slug: 'work-queue', entityName: '' }, // UI-only view
            { label: 'Fronta práce nesting', slug: 'nesting-work-queue', entityName: '' }, // UI-only view
            { label: 'Incidenty', slug: 'incident', entityName: 'Incident' },
            { label: 'Kamery', slug: 'cameras', entityName: 'Camera' },
            { label: 'Kontrolní panel', slug: 'control-panel', entityName: '' }, // UI-only view
            { label: 'Naplánované dávky', slug: 'mds-planned-batch', entityName: 'MDSPlannedBatch' },
            { label: 'Pracoviště program.', slug: 'programming-stage', entityName: 'ProgrammingStage' },
            { label: 'Výroba', slug: 'production-stages', entityName: 'Stage' },
            { label: 'Výrobní plán', slug: 'production-schedule', entityName: 'ProductionSchedule' },
            { label: 'Záznamy práce', slug: 'work-record', entityName: 'WorkRecord' },
        ],
    },
];
// Build comprehensive entity resolver from API metadata at runtime
export function buildEntityResolver(apiEntities) {
    const map = new Map();
    for (const e of apiEntities) {
        map.set(e.name, e.name);
        map.set(e.name.toLowerCase(), e.name);
        if (e.endpointUrl) {
            const cleaned = e.endpointUrl.replace(/^\/api\//, '').replace(/^query\//, '');
            map.set(cleaned, e.name);
            map.set(cleaned.toLowerCase(), e.name);
        }
        // PascalCase → kebab-case
        const kebab = e.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
        map.set(kebab, e.name);
        // MDS prefix: MDSPlannedBatch → mds-planned-batch
        const kebab2 = e.name.replace(/^MDS/, 'Mds').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
        map.set(kebab2, e.name);
        if (e.label) {
            map.set(e.label.toLowerCase(), e.name);
        }
    }
    return map;
}
//# sourceMappingURL=factorify-menu.js.map