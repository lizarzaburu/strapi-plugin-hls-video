import { useCallback, useEffect, useState } from 'react';

import {
  Badge,
  Box,
  Button,
  Flex,
  Main,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise } from '@strapi/icons';
import { Page } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';

import { useHlsApi, type JobView, type WorkerState } from '../api';
import { getTranslation } from '../utils/getTranslation';

const POLL_MS = 5000;

const STATUS_COLOR: Record<JobView['status'], 'secondary' | 'alternative' | 'success' | 'danger'> =
  {
    queued: 'secondary',
    processing: 'alternative',
    ready: 'success',
    failed: 'danger',
  };

const HomePage = () => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const api = useHlsApi();
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [status, setStatus] = useState<WorkerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, state] = await Promise.all([api.listJobs(), api.status()]);
      setJobs(list);
      setStatus(state);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const retry = async (id: number) => {
    setRetrying(id);
    try {
      await api.retry(id);
      await load();
    } finally {
      setRetrying(null);
    }
  };

  if (loading) return <Page.Loading />;

  return (
    <Main>
      <Box padding={8}>
        <Flex justifyContent="space-between" alignItems="flex-start" marginBottom={4}>
          <Box>
            <Typography variant="alpha" tag="h1">
              {t('page.title')}
            </Typography>
            <Typography variant="epsilon" textColor="neutral600">
              {t('page.subtitle')}
            </Typography>
          </Box>
          <Button variant="secondary" startIcon={<ArrowClockwise />} onClick={() => void load()}>
            {t('action.refresh')}
          </Button>
        </Flex>

        {status && (
          <Flex gap={2} marginBottom={6} wrap="wrap">
            <Badge active={status.busy}>
              {status.busy && status.currentJobId !== null
                ? t('status.worker.busy', { id: status.currentJobId })
                : t('status.worker.idle')}
            </Badge>
            <Badge
              backgroundColor={status.ffmpegAvailable ? 'success100' : 'danger100'}
              textColor={status.ffmpegAvailable ? 'success700' : 'danger700'}
            >
              {status.ffmpegAvailable ? t('status.ffmpeg.ok') : t('status.ffmpeg.missing')}
            </Badge>
            <Badge>{t('status.memory', { mb: status.freeMemoryMb })}</Badge>
          </Flex>
        )}

        {jobs.length === 0 ? (
          <Typography textColor="neutral600">{t('table.empty')}</Typography>
        ) : (
          <Table colCount={8} rowCount={jobs.length + 1}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">{t('table.file')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('table.status')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('table.version')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('table.attempts')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('table.duration')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('table.updated')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('table.error')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('table.actions')}</Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {jobs.map((job) => (
                <Tr key={job.id}>
                  <Td>
                    <Typography>{job.fileName ?? t('table.fileDeleted')}</Typography>
                  </Td>
                  <Td>
                    <Badge
                      backgroundColor={`${STATUS_COLOR[job.status]}100`}
                      textColor={`${STATUS_COLOR[job.status]}700`}
                    >
                      {t(`status.${job.status}`)}
                    </Badge>
                  </Td>
                  <Td>
                    <Typography>v{job.version}</Typography>
                  </Td>
                  <Td>
                    <Typography>{job.attempts}</Typography>
                  </Td>
                  <Td>
                    <Typography>
                      {job.durationMs ? `${Math.round(job.durationMs / 1000)} s` : '–'}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography>{new Date(job.updatedAt).toLocaleString()}</Typography>
                  </Td>
                  <Td>
                    <Typography
                      textColor="danger600"
                      style={{ whiteSpace: 'pre-wrap', maxWidth: 360, display: 'block' }}
                    >
                      {job.error ?? ''}
                    </Typography>
                  </Td>
                  <Td>
                    <Button
                      size="S"
                      variant="tertiary"
                      disabled={
                        job.fileName === null || retrying === job.id || job.status === 'processing'
                      }
                      onClick={() => void retry(job.id)}
                    >
                      {t('action.retry')}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Box>
    </Main>
  );
};

export { HomePage };
