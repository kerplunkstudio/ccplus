import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';

export interface ScheduledTask {
  id: string;
  prompt: string;
  cronExpression: string;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
  paused: boolean;
}

interface UseSchedulerProps {
  socket: Socket | null;
  sessionId: string;
}

export function useScheduler({ socket, sessionId }: UseSchedulerProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const currentSessionIdRef = useRef<string>(sessionId);

  // Update session ID ref
  useEffect(() => {
    currentSessionIdRef.current = sessionId;
  }, [sessionId]);

  const createTask = useCallback((prompt: string, interval: string) => {
    if (!socket) return;

    socket.emit('schedule_create', {
      prompt,
      interval,
      session_id: currentSessionIdRef.current,
    });
  }, [socket]);

  const deleteTask = useCallback((id: string) => {
    if (!socket) return;

    socket.emit('schedule_delete', { id });
  }, [socket]);

  const pauseTask = useCallback((id: string) => {
    if (!socket) return;

    socket.emit('schedule_pause', { id });
  }, [socket]);

  const resumeTask = useCallback((id: string) => {
    if (!socket) return;

    socket.emit('schedule_resume', { id });
  }, [socket]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleScheduleCreated = (data: { task: ScheduledTask }) => {
      setTasks(prev => [...prev, data.task]);
    };

    const handleScheduleDeleted = (data: { id: string }) => {
      setTasks(prev => prev.filter(t => t.id !== data.id));
    };

    const handleScheduleUpdated = (data: { task: ScheduledTask }) => {
      setTasks(prev => prev.map(t => t.id === data.task.id ? data.task : t));
    };

    const handleScheduleFired = (data: { id: string; prompt: string; timestamp: number }) => {
      // Optionally update UI to show a task just fired
      // For now, we'll just log it
      console.log(`Task ${data.id} fired at ${new Date(data.timestamp).toISOString()}`);
    };

    const handleScheduleList = (data: { tasks: ScheduledTask[] }) => {
      setTasks(data.tasks);
    };

    socket.on('schedule_created', handleScheduleCreated);
    socket.on('schedule_deleted', handleScheduleDeleted);
    socket.on('schedule_updated', handleScheduleUpdated);
    socket.on('schedule_fired', handleScheduleFired);
    socket.on('schedule_list', handleScheduleList);

    return () => {
      socket.off('schedule_created', handleScheduleCreated);
      socket.off('schedule_deleted', handleScheduleDeleted);
      socket.off('schedule_updated', handleScheduleUpdated);
      socket.off('schedule_fired', handleScheduleFired);
      socket.off('schedule_list', handleScheduleList);
    };
  }, [socket]);

  // Sync tasks on mount or session change
  useEffect(() => {
    if (!socket || !sessionId) return;

    socket.emit('schedule_list', { session_id: sessionId });
  }, [socket, sessionId]);

  return {
    tasks,
    createTask,
    deleteTask,
    pauseTask,
    resumeTask,
  };
}
