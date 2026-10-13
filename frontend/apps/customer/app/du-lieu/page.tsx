import { DataManagement } from '../../../../packages/ui/src/components/shared/data-setup'
import { RawDataExportPage } from '@/components/shared/data-export'
import { IS_UNIFIED_APP } from '@/lib/env'

export default function Page() { return IS_UNIFIED_APP ? <DataManagement /> : <RawDataExportPage role="customer" /> }
