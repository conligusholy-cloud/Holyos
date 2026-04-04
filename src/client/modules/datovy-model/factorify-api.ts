/* ============================================
   factorify-api.ts — Factorify Data Browser
   API layer for browsing entities and records
   ============================================ */

export interface EntityInfo {
  name: string;
  label: string;
  labelPlural: string;
  category: string;
  endpointUrl: string;
}

export interface EntityFieldMeta {
  name: string;
  label: string;
  mandatory: boolean;
  readOnly: boolean;
  hidden: boolean;
  position: number;
}

export interface QueryResult {
  rows: any[];
  totalCount: number;
}

// Factorify category mapping based on real sidebar structure
const CATEGORY_MAP: Record<string, string[]> = {
  'VÝROBA': [
    'Stage', 'Operation', 'WorkflowOperation', 'ProductionOrder', 'ProductionBatch',
    'ProductionLine', 'ProductionLineStage', 'Machine', 'MachineState', 'MachineProgram',
    'Tool', 'ToolType', 'Workstation', 'WorkRecord', 'DailyReport', 'DailyReportNote',
    'ManufacturingOrder', 'OperationMachineProgram', 'ProductionCriteriaRequirement',
    'ProductionLineSanitation', 'StrategicPlanGoodsCapacity', 'NestingBatchEntity',
    'WorkflowDrawing', 'WorkflowOperationCarrier', 'PassiveWorkflowOperation',
    'PassiveTactWorkflowOperation', 'MultitaskingWorkflowOperation',
    'WorkflowOperationRequiredDocument', 'WorkflowRequiredInformation',
  ],
  'ZBOŽÍ': [
    'Goods', 'GoodsType', 'GoodsTypeParameter', 'GoodsGroup', 'GoodsState',
    'Bom', 'BomItem', 'AlternativeGoodsGroup', 'BlockedGoods', 'ForecastGoods',
    'GoodsMinimalStockHistory', 'GoodsInEconomy', 'AccountAssignmentItem',
    'EshopGoods', 'EshopGoodsOption',
  ],
  'SKLADY': [
    'Warehouse', 'StockItem', 'Batch', 'StockMovement', 'StockSupplyEntity',
    'PurchasedStockItem', 'WarehouseFloorPlanRack', 'Pallet', 'StockSqlEntity',
    'UsedBatchesEvidence', 'LoadingStage',
  ],
  'PRODEJ': [
    'SalesOrder', 'SalesOrderItem', 'Offer', 'OfferItem', 'OfferAttachment',
    'Delivery', 'DeliveryItem', 'PriceList', 'PriceListItem', 'SalesArea',
    'BusinessCase', 'BusinessCasePriceListItem', 'AppliedDocument',
    'DeliveryForOrderAssemblyGoodsEntity',
  ],
  'NÁKUP': [
    'PurchaseOrder', 'PurchaseOrderItem', 'PurchasePriceComponent',
    'DemandedGoodsEntity',
  ],
  'KOOPERACE': [
    'CooperationOrder', 'CooperationPlan', 'MDSCooperationBatch',
    'AccountingDocumentsCooperationOrders',
  ],
  'FINANCE': [
    'Invoice', 'InvoiceItem', 'Account', 'AccountGroup', 'AccountingDocument',
    'AccountingDocumentAttachment', 'AccountingDocumentSqlEntity',
    'AccountingPeriod', 'AccountingTransaction', 'AccountingTransactionV',
    'Payment', 'PaymentOrder', 'PaymentOrderItem', 'PaymentMethod',
    'BankStatement', 'CashRegisterSqlEntity', 'CashFlowRow',
    'VatRate', 'VatReportItem', 'VatAccountAssignment',
    'DocumentValueAccountAssignment', 'Currency', 'LongTermAssetType',
    'CostCenter', 'EcoCostStructure', 'EcoCostStructureAccountingFilter',
    'EcoPlannerCostRecord', 'EcoPlannedCostRecord',
  ],
  'HR': [
    'Employee', 'Person', 'PersonContract', 'PersonCertificate',
    'Shift', 'AssignedShift', 'Absence', 'AbsenceType', 'AbsenceEntitlement',
    'AttendanceRecord', 'MonthlyAttendanceParametersView',
    'Salary', 'SalaryParameter', 'SalaryAssessment', 'GuaranteedSalary',
    'OvertimeTransfer', 'SharedWorkers', 'MinimumBreakDistance',
    'MedicalCheckupType', 'Injury', 'InjuryAttachment',
    'BusinessTrip', 'BusinessTripWorkRecord', 'WorkOutsideSchedule',
    'MealBoxContent',
  ],
  'CRM': [
    'Customer', 'Supplier', 'Contact', 'Counterparty', 'CounterpartyBankAccount',
    'CommunicationHistory', 'ReceivedEmail', 'Comment',
    'Country', 'CzFinancialOffice', 'MDSCompany', 'MDSDPHSHVReport',
  ],
  'E-SHOP': [
    'EshopStore', 'EshopCategory', 'EshopCountry', 'EshopMetaTag',
  ],
  'PROJEKTY': [
    'Project', 'Activity', 'ForecastGroup', 'DispositionAreaRatio',
    'TransferTruckType',
  ],
  'NASTAVENÍ': [
    'AccountingUnit', 'AccountingUnitConfiguration', 'AccountingUnitPaymentDetail',
    'NumberSeries', 'DocumentType', 'Permission', 'Role',
    'EmbeddedReport', 'ColorMappingSetting', 'PersistedEntityRow',
    'DecisionBranch', 'ProductTemplateAttachment', 'SessionDb',
    'WorkspaceColumn', 'WorkspaceColumnEntity',
  ],
};

function detectCategory(name: string): string {
  for (const [cat, entities] of Object.entries(CATEGORY_MAP)) {
    if (entities.includes(name)) return cat;
  }
  // Fallback pattern matching
  const n = name.toLowerCase();
  if (/good|item|product|material|bom|recipe/.test(n)) return 'ZBOŽÍ';
  if (/stage|operation|routing|workstation|machine|tool|production|manufacturing|workplace|workflow/.test(n)) return 'VÝROBA';
  if (/warehouse|stock|inventory|batch|storage|location|pallet/.test(n)) return 'SKLADY';
  if (/sales|offer|delivery|pricelist|business/.test(n)) return 'PRODEJ';
  if (/purchase/.test(n)) return 'NÁKUP';
  if (/cooperation/.test(n)) return 'KOOPERACE';
  if (/invoice|payment|price|currency|vat|tax|finance|account|ledger|cashbook|bank|cost/.test(n)) return 'FINANCE';
  if (/employee|worker|shift|attendance|salary|hr|person|absence|injury|medical/.test(n)) return 'HR';
  if (/customer|supplier|contact|partner|crm|lead|counterparty|communication/.test(n)) return 'CRM';
  if (/eshop|cart|catalog|web/.test(n)) return 'E-SHOP';
  if (/project|activity|forecast/.test(n)) return 'PROJEKTY';
  if (/setting|config|param|number|series|template|document|report|permission|role/.test(n)) return 'NASTAVENÍ';
  return 'OSTATNÍ';
}

// Category display order and icons
export const CATEGORY_ORDER: { key: string; icon: string; color: string }[] = [
  { key: 'VÝROBA', icon: '⚙', color: '#0d9488' },
  { key: 'ZBOŽÍ', icon: '📦', color: '#059669' },
  { key: 'SKLADY', icon: '🏭', color: '#d97706' },
  { key: 'PRODEJ', icon: '💰', color: '#2563eb' },
  { key: 'NÁKUP', icon: '🛒', color: '#7c3aed' },
  { key: 'KOOPERACE', icon: '🤝', color: '#0891b2' },
  { key: 'FINANCE', icon: '📊', color: '#a855f7' },
  { key: 'HR', icon: '👤', color: '#db2777' },
  { key: 'CRM', icon: '📇', color: '#4f46e5' },
  { key: 'E-SHOP', icon: '🛍', color: '#e11d48' },
  { key: 'PROJEKTY', icon: '📋', color: '#0891b2' },
  { key: 'NASTAVENÍ', icon: '⚙', color: '#6b7280' },
  { key: 'OSTATNÍ', icon: '📁', color: '#475569' },
];

export const FactorifyBrowser = {
  entities: [] as EntityInfo[],
  entityMap: new Map<string, EntityInfo>(),
  categories: new Map<string, EntityInfo[]>(),
  fieldCache: new Map<string, EntityFieldMeta[]>(),
  loading: false,
  error: null as string | null,

  async fetchAPI(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
    const method = options.method || 'GET';
    const fetchOpts: RequestInit = {
      method,
      headers: { 'Accept': 'application/json', 'X-FySerialization': 'ui2' },
    };
    if (options.body) {
      (fetchOpts.headers as any)['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(options.body);
    }
    const resp = await fetch(window.location.origin + path, fetchOpts);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
    }
    return await resp.json();
  },

  // Load all entities and organize by category
  async loadEntities(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const data = await this.fetchAPI('/api/metadata/entities') as any[];
      const raw: any[] = Array.isArray(data) ? data : [];

      this.entities = [];
      this.entityMap.clear();
      this.categories.clear();

      for (const item of raw) {
        const name = typeof item === 'string' ? item : (item.name || '');
        if (!name) continue;
        const info: EntityInfo = {
          name,
          label: item.label || name,
          labelPlural: item.labelPlural || item.label || name,
          category: detectCategory(name),
          endpointUrl: item.endpointUrl || '',
        };
        this.entities.push(info);
        this.entityMap.set(name, info);

        if (!this.categories.has(info.category)) {
          this.categories.set(info.category, []);
        }
        this.categories.get(info.category)!.push(info);
      }

      // Sort entities within each category
      for (const [, list] of this.categories) {
        list.sort((a, b) => a.label.localeCompare(b.label, 'cs'));
      }

      this.loading = false;
    } catch (err) {
      this.error = (err as Error).message;
      this.loading = false;
      throw err;
    }
  },

  // Load field metadata for an entity (cached)
  async loadFields(entityName: string): Promise<EntityFieldMeta[]> {
    if (this.fieldCache.has(entityName)) return this.fieldCache.get(entityName)!;

    try {
      const data = await this.fetchAPI('/api/metadata/entity/' + entityName) as any;
      const rawFields = data.fields || [];
      const fields: EntityFieldMeta[] = rawFields
        .map((f: any) => ({
          name: f.name || '',
          label: f.label || f.name || '',
          mandatory: !!f.mandatory,
          readOnly: !!f.readOnly,
          hidden: !!f.hidden,
          position: f.position ?? 999,
        }))
        .filter((f: EntityFieldMeta) => !f.hidden && f.name !== 'warnings')
        .sort((a: EntityFieldMeta, b: EntityFieldMeta) => a.position - b.position);

      this.fieldCache.set(entityName, fields);
      return fields;
    } catch {
      return [];
    }
  },

  // Query entity records with pagination and sorting
  async queryRecords(
    entityName: string,
    options: { offset?: number; limit?: number; orderBy?: string; orderDir?: string; search?: string } = {}
  ): Promise<QueryResult> {
    const body: any = {
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    };

    if (options.orderBy) {
      body.orderBy = [{ field: options.orderBy, order: options.orderDir || 'ASC' }];
    }

    if (options.search) {
      body.fulltext = options.search;
    }

    const data = await this.fetchAPI('/api/query/' + entityName, {
      method: 'POST',
      body,
    }) as any;

    return {
      rows: data.rows || [],
      totalCount: data.totalCount ?? data.count ?? (data.rows ? data.rows.length : 0),
    };
  },

  // Get a single record by ID
  async getRecord(entityName: string, id: string | number): Promise<any> {
    const data = await this.fetchAPI('/api/query/' + entityName, {
      method: 'POST',
      body: { filters: [{ field: 'id', operator: 'eq', value: id }], limit: 1 },
    }) as any;
    return data.rows?.[0] || null;
  },
};
