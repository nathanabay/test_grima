import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { JournalService } from './journal.service';
import { ValuationService } from './valuation.service';
import { PostingService } from './posting.service';
import { FinanceNotesService } from './notes.service';
import { AuthenticatedUser, CurrentUser, RequirePermissions } from '../../common/decorators';

@ApiTags('Accounting')
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly journal: JournalService,
    private readonly valuation: ValuationService,
    private readonly posting: PostingService,
    private readonly notes: FinanceNotesService,
  ) {}

  // ---- Chart of accounts ----

  @Get('accounts')
  @RequirePermissions('finance.account.READ')
  listAccounts(@Query('includeInactive') includeInactive?: string) {
    return this.accounts.list(includeInactive === 'true');
  }

  @Get('accounts/mapping-health')
  @RequirePermissions('finance.account.READ')
  @ApiOperation({ summary: 'Posting keys with no account behind them' })
  mappingHealth() {
    return this.accounts.mappingHealth();
  }

  @Get('accounts/:id')
  @RequirePermissions('finance.account.READ')
  getAccount(@Param('id') id: string) {
    return this.accounts.get(id);
  }

  @Get('accounts/:id/ledger')
  @RequirePermissions('finance.account.READ')
  @ApiOperation({ summary: 'Every posting on one account, with a running balance' })
  accountLedger(@Param('id') id: string, @Query() query: any) {
    return this.journal.accountLedger(id, {
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 100,
    });
  }

  @Post('accounts')
  @RequirePermissions('finance.account.CREATE')
  createAccount(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.create(body, user);
  }

  @Patch('accounts/:id')
  @RequirePermissions('finance.account.EDIT')
  updateAccount(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.update(id, body, user);
  }

  @Post('accounts/ensure-defaults')
  @RequirePermissions('finance.account.CREATE')
  @ApiOperation({ summary: 'Create any missing default account without touching existing ones' })
  ensureDefaults(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.ensureDefaults(user);
  }

  // ---- Journals ----

  @Get('journal')
  @RequirePermissions('finance.journal.READ')
  listEntries(@Query() query: any) {
    return this.journal.list({
      sourceType: query.sourceType,
      accountId: query.accountId,
      branchId: query.branchId,
      status: query.status,
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 50,
    });
  }

  @Get('journal/:id')
  @RequirePermissions('finance.journal.READ')
  getEntry(@Param('id') id: string) {
    return this.journal.get(id);
  }

  @Post('journal')
  @RequirePermissions('finance.journal.CREATE')
  @ApiOperation({ summary: 'Post a manual balanced journal entry' })
  createEntry(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.journal.postStandalone({ ...body, sourceType: body.sourceType ?? 'MANUAL' }, user);
  }

  @Post('journal/:id/reverse')
  @RequirePermissions('finance.journal.CANCEL')
  @ApiOperation({ summary: 'Reverse a posted entry; the original is never edited' })
  reverse(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.journal.reverse(id, body.reason, user);
  }

  @Get('trial-balance')
  @RequirePermissions('finance.report.READ')
  trialBalance(@Query() query: any) {
    return this.journal.trialBalance({ from: query.from, to: query.to, branchId: query.branchId });
  }

  // ---- Valuation ----

  @Get('valuation')
  @RequirePermissions('finance.report.READ')
  @ApiOperation({ summary: 'Inventory value at the configured method, with the basis stated' })
  inventoryValue(@Query() query: any) {
    return this.valuation.inventoryValue({
      warehouseId: query.warehouseId,
      branchId: query.branchId,
    });
  }

  @Get('valuation/reconciliation')
  @RequirePermissions('finance.report.READ')
  @ApiOperation({ summary: 'Inventory account against the physical stock valuation' })
  reconciliation() {
    return this.valuation.reconcileToLedger();
  }

  @Get('valuation/layers/:productId')
  @RequirePermissions('finance.report.READ')
  @ApiOperation({ summary: 'The cost layers behind one product' })
  layers(@Param('productId') productId: string, @Query('warehouseId') warehouseId?: string) {
    return this.valuation.layersFor(productId, warehouseId);
  }

  @Get('valuation/consumption/:transactionId')
  @RequirePermissions('finance.report.READ')
  @ApiOperation({ summary: 'What one issue cost, layer by layer' })
  consumption(@Param('transactionId') transactionId: string) {
    return this.valuation.consumptionFor(transactionId);
  }

  // ---- Posting ----

  @Post('post-pending')
  @RequirePermissions('finance.journal.CREATE')
  @ApiOperation({ summary: 'Post every document that has not reached the ledger yet' })
  postPending(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.posting.postPending(body?.limit ?? 500, user);
  }

  @Get('unposted')
  @RequirePermissions('finance.report.READ')
  @ApiOperation({ summary: 'Documents that should have reached the ledger and have not' })
  unposted(@Query('limit') limit?: string) {
    return this.posting.unpostedDocuments(limit ? Number(limit) : 100);
  }

  // ---- Periods ----

  @Get('periods')
  @RequirePermissions('finance.report.READ')
  periods() {
    return this.accounts.listPeriods();
  }

  @Post('periods')
  @RequirePermissions('finance.journal.CREATE')
  createPeriod(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.createPeriod(body, user);
  }

  @Post('periods/:id/close')
  @RequirePermissions('finance.journal.APPROVE')
  @ApiOperation({ summary: 'Close a period; refuses while movements are unposted' })
  closePeriod(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.closePeriod(id, user);
  }

  @Post('periods/:id/reopen')
  @RequirePermissions('finance.journal.APPROVE')
  reopenPeriod(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.accounts.reopenPeriod(id, body.reason, user);
  }

  // ---- Credit and debit notes ----

  @Get('notes')
  @RequirePermissions('finance.invoice.READ')
  listNotes(@Query() query: any) {
    return this.notes.list({
      direction: query.direction,
      status: query.status,
      supplierId: query.supplierId,
    });
  }

  @Get('notes/:id')
  @RequirePermissions('finance.invoice.READ')
  getNote(@Param('id') id: string) {
    return this.notes.get(id);
  }

  @Post('notes')
  @RequirePermissions('finance.invoice.CREATE')
  createNote(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.create(body, user);
  }

  @Post('notes/:id/issue')
  @RequirePermissions('finance.invoice.APPROVE')
  @ApiOperation({ summary: 'Issue a note and post it; the raiser cannot issue their own' })
  issueNote(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.issue(id, user);
  }

  @Post('notes/:id/cancel')
  @RequirePermissions('finance.invoice.EDIT')
  cancelNote(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.cancel(id, body.reason, user);
  }
}
