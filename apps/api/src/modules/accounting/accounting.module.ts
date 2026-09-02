import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountsService } from './accounts.service';
import { JournalService } from './journal.service';
import { ValuationService } from './valuation.service';
import { PostingService } from './posting.service';
import { FinanceNotesService } from './notes.service';

@Module({
  controllers: [AccountingController],
  providers: [
    AccountsService,
    JournalService,
    ValuationService,
    PostingService,
    FinanceNotesService,
  ],
  exports: [AccountsService, JournalService, ValuationService, PostingService],
})
export class AccountingModule {}
