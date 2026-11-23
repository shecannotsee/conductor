const { nowTs, getConversation } = require('../conversation_service');
const {
  USAGE_META_KEYS,
  normalizeAssistantRuntimeText,
  normalizeMessageUsage,
  normalizeMessageUsageFromMeta,
} = require('./chat_helpers');

function bindChatRunnerEvents(controller, {
  targetId,
  runner,
  userText,
  enableStreamPreview = false,
}) {
  const makeGroup = (anchor = null) => ({
    anchor, message: null,
    execution: { id: require('node:crypto').randomUUID(), status: 'running', startedAt: nowTs(), completedAt: 0, hasFinal: false, activeText: '', steps: [] },
  });
  const groups = [makeGroup()];
  const groupBySegment = new Map();
  let currentGroup = groups[0];
  let segmentedMessage = null;
  let segmentTimer = null;
  let segments = [];
  const publishSegments = () => {
    if (segmentTimer) clearTimeout(segmentTimer);
    segmentTimer = null;
    const conv = getConversation(controller.conversations, targetId);
    if (!conv) return;
    for (const group of groups) {
      const items = segments.filter(item => groupBySegment.get(item.id) === group);
      const execution = group.execution;
      execution.steps = items.filter(item => item.phase === 'commentary' && item.text.trim()).map(item => ({ id: item.id, text: item.text, createdAt: item.createdAt, completed: item.completed }));
      execution.hasFinal = items.some(item => item.phase === 'final' && item.text.trim());
      execution.activeText = execution.status === 'running' ? items.filter(item => !item.completed).map(item => item.text).filter(Boolean).join('\n\n') : '';
      const text = items.filter(item => item.phase !== 'commentary' && (item.completed || execution.status !== 'running')).map(item => item.text).filter(Boolean).join('\n\n');
      if (!text && !execution.steps.length && !execution.activeText) continue;
      if (!group.message) {
        group.message = { role: 'assistant', text: '', createdAt: nowTs(), execution };
        // Late completion of an earlier item must stay before the inserted user message.
        const nextAnchor = groups.slice(groups.indexOf(group) + 1).map(next => conv.messages.indexOf(next.anchor)).find(index => index >= 0);
        conv.messages.splice(nextAnchor ?? conv.messages.length, 0, group.message);
      }
      group.message.text = text;
    }
    segmentedMessage = [...groups].reverse().find(group => group.message?.text.trim())?.message || currentGroup.message;
    controller.assistantBufferByRunner.set(runner, segmentedMessage?.text || '');
    conv.updatedAt = nowTs();
    controller._syncConversationUpdated(conv);
    controller._schedulePersist();
  };
  runner.on('assistant_segments', items => {
    controller._markRequestWaitNoticeResponded(runner);
    segments = items;
    for (const item of items) if (!groupBySegment.has(item.id)) groupBySegment.set(item.id, currentGroup);
    if (!segmentTimer) segmentTimer = setTimeout(publishSegments, 120);
  });
  runner.on('user_inserted', message => {
    publishSegments();
    currentGroup.execution.status = 'completed';
    currentGroup.execution.completedAt = nowTs();
    currentGroup = makeGroup(message);
    groups.push(currentGroup);
  });
  runner.on('user_insert_failed', message => {
    if (currentGroup.anchor !== message) return;
    const rejectedGroup = groups.pop();
    currentGroup = groups[groups.length - 1];
    for (const [id, group] of groupBySegment) {
      if (group === rejectedGroup) groupBySegment.set(id, currentGroup);
    }
    const conv = getConversation(controller.conversations, targetId);
    const index = conv?.messages.indexOf(rejectedGroup.message) ?? -1;
    if (index >= 0) conv.messages.splice(index, 1);
    currentGroup.execution.status = 'running';
    currentGroup.execution.completedAt = 0;
    publishSegments();
  });
  runner.on('status', (phase) => {
    controller._setPhase(targetId, phase);
  });

  runner.on('event', (level, message) => {
    controller._appendStructuredEvent(targetId, level, message, {
      kind: controller._inferStructuredEventKind(level, message),
    });
  });

  runner.on('raw_line', (line) => {
    controller._markRequestWaitNoticeResponded(runner);
    controller._appendRawJsonLine(targetId, line);
  });

  runner.on('meta', (key, value) => {
    controller._markRequestWaitNoticeResponded(runner);
    const meta = controller._ensureMeta(targetId);
    meta[key] = value;

    if (key === '会话ID') {
      const targetConv = getConversation(controller.conversations, targetId);
      if (targetConv) {
        targetConv.sessionId = value;
        if (targetConv.sessionContinuationMode === 'fork' && value && value !== '-') {
          targetConv.sessionContinuationMode = 'resume';
        }
        targetConv.updatedAt = nowTs();
        controller._syncConversationUpdated(targetConv);
      }
    }

    controller._emit({ type: 'meta-updated', conversationId: targetId, key, value });
    if (!USAGE_META_KEYS.has(key)) {
      controller._appendStructuredEvent(targetId, 'hint', `${key}: ${value}`, {
        kind: controller._inferStructuredEventKind('hint', `${key}: ${value}`, key),
      });
    }
  });

  runner.on('assistant_delta', (delta) => {
    if (runner.supportsAssistantSegments) return;
    controller._markRequestWaitNoticeResponded(runner);
    const current = controller.assistantBufferByRunner.get(runner) || '';
    const next = current + String(delta || '');
    controller.assistantBufferByRunner.set(runner, next);
    if (enableStreamPreview) {
      controller._maybeEmitStreamingAssistantUpdate(targetId, runner, delta, { text: next });
    }
  });

  runner.on('assistant_update', (payload) => {
    controller._markRequestWaitNoticeResponded(runner);
    const text = normalizeAssistantRuntimeText(payload?.text || '');
    if (!text) {
      return;
    }
    // Segmented chat rendering must not disable the original runtime progress.
    if (runner.supportsAssistantSegments) {
      const currentRound = Math.max(1, controller.roundIndexByRunner.get(runner) || 1);
      const segmentIndex = controller._resolveAssistantProgressSegmentIndex(targetId, currentRound);
      controller._appendStructuredAssistantProgress(targetId, text, { roundIndex: currentRound, segmentIndex });
      controller._appendWorkflowAssistantProgress(targetId, currentRound, text, { segmentIndex });
      controller._sealAssistantProgressSegments(targetId, currentRound);
      return;
    }
    const bufferedText = normalizeAssistantRuntimeText(controller.assistantBufferByRunner.get(runner) || '');
    const previewText = bufferedText.length >= text.length ? bufferedText : text;
    if (previewText.length > bufferedText.length) {
      controller.assistantBufferByRunner.set(runner, previewText);
    }
    if (enableStreamPreview) {
      controller._maybeEmitStreamingAssistantUpdate(targetId, runner, '', { text: previewText, force: true });
    }
    const currentRound = Math.max(1, controller.roundIndexByRunner.get(runner) || 1);
    const segmentIndex = controller._resolveAssistantProgressSegmentIndex(targetId, currentRound);
    controller._appendStructuredAssistantProgress(targetId, previewText, { roundIndex: currentRound, segmentIndex });
    controller._appendWorkflowAssistantProgress(targetId, currentRound, previewText, { segmentIndex });
  });

  runner.on('plan_update', (payload) => {
    controller._markRequestWaitNoticeResponded(runner);
    const currentRound = Math.max(1, controller.roundIndexByRunner.get(runner) || 1);
    controller._sealAssistantProgressSegments(targetId, currentRound);
    controller._upsertWorkflowPlan(targetId, currentRound, payload);
  });

  runner.on('step', (step) => {
    controller._markRequestWaitNoticeResponded(runner);
    const currentRound = Math.max(1, controller.roundIndexByRunner.get(runner) || 1);
    const stepIndex = (controller.stepIndexByRunner.get(runner) || 0) + 1;
    controller.stepIndexByRunner.set(runner, stepIndex);
    controller._sealAssistantProgressSegments(targetId, currentRound);

    const rawStep = String(step || '').trim();
    const commandPurpose = /执行命令:|命令执行完成/.test(rawStep)
      ? controller._resolveLatestWorkflowPurpose(targetId, currentRound)
      : '';
    const textStep = `R${currentRound}-S${stepIndex}. ${rawStep}`;
    controller._appendWorkflowStep(targetId, textStep, { purpose: commandPurpose });

    let summary = rawStep.replace(/\s+/g, ' ').trim();
    if (commandPurpose && /执行命令:|命令执行完成/.test(rawStep)) {
      summary = `${summary} | 目的: ${commandPurpose}`;
    }
    if (summary.length > 160) {
      summary = `${summary.slice(0, 160).trimEnd()}...`;
    }
    const latestRawItem = controller._latestRawItem(
      targetId,
      (item) => String(item?.direction || '').trim().toLowerCase() === 'received',
    );
    controller._appendStructuredEvent(
      targetId,
      'info',
      `R${currentRound}-S${stepIndex}: ${summary}`,
      {
        kind: 'step-summary',
        body: rawStep,
        ...(latestRawItem?.id ? { rawRefId: String(latestRawItem.id) } : {}),
        rawRefLabel: '查看原文',
      },
    );
  });

  runner.on('finished', (result) => {
    if (segmentTimer) { clearTimeout(segmentTimer); segmentTimer = null; }
    if (runner.supportsAssistantSegments) {
      for (const group of groups) {
        group.execution.status = runner.stopped ? 'interrupted' : result.exitCode === 0 ? 'completed' : 'failed';
        group.execution.completedAt = nowTs();
      }
      publishSegments();
    }
    const targetConv = getConversation(controller.conversations, targetId);
    const runtimeState = controller.runtimeStore.ensure(targetId);
    const currentRound = Math.max(1, controller.roundIndexByRunner.get(runner) || 1);
    const userMessageState = controller.userMessageByRunner.get(runner);
    const completedUserText = String(userMessageState?.message?.text || userText || '').trim();

    if (targetConv) {
      if (result.sessionId) {
        targetConv.sessionId = result.sessionId;
      } else if (result.sessionResetSuggested) {
        targetConv.sessionId = '';
        controller._appendStructuredEvent(targetId, 'warn', '已清空失效会话ID，下一次将自动创建新会话');
      }
    }

    const finalText = runner.supportsAssistantSegments && segments.length
      ? String(segmentedMessage?.text || '').trim()
      : (controller.assistantBufferByRunner.get(runner) || '').trim() || String(result.assistantText || '').trim();
    controller._sealAssistantProgressSegments(targetId, currentRound);
    while (controller._removeLastStructuredEventIf(
      targetId,
      (item) => item?.kind === 'assistant-update',
    )) {}
    while (controller._removeLastWorkflowItemIf(
      targetId,
      (item) => item.type === 'assistant'
        && item.status === 'running'
        && Number(item.roundIndex || 0) === currentRound,
    )) {}
    if (finalText && targetConv) {
      controller._appendWorkflowAssistantReply(targetId, currentRound, finalText);
      const metaModel = String(controller._ensureMeta(targetId)?.['模型'] || '').trim();
      const messageUsage = normalizeMessageUsage(
        result?.usage,
        String(result?.model || '').trim() || metaModel,
      ) || normalizeMessageUsageFromMeta(controller._ensureMeta(targetId));
      const reply = {
        role: 'assistant',
        text: finalText,
        model: String(result?.model || runner.replyIdentity?.model || messageUsage?.model || ''),
        reasoningEffort: String(runner.replyIdentity?.reasoningEffort || ''),
        ...(messageUsage ? { usage: messageUsage } : {}),
        createdAt: nowTs(),
      };
      if (segmentedMessage) Object.assign(segmentedMessage, reply);
      else targetConv.messages.push(reply);
    } else if (!finalText && targetConv && result.exitCode === 0) {
      controller._appendStructuredEvent(targetId, 'warn', 'Codex 未返回可解析内容（请查看右侧运行步骤/事件原文）');
    }

    if (result.exitCode === 0) {
      runtimeState.phase = '已完成';
      controller._appendStructuredEvent(targetId, 'success', '任务完成');
    } else {
      runtimeState.phase = '失败';
      controller._appendStructuredEvent(
        targetId,
        'error',
        `任务失败，退出码 ${result.exitCode}`,
      );
    }

    if (targetConv) {
      targetConv.updatedAt = nowTs();
      controller._syncConversationUpdated(targetConv);
    }

    runtimeState.startedAt = null;
    controller._emit({ type: 'runtime-started-at', conversationId: targetId, startedAt: null });
    controller._setPhase(targetId, runtimeState.phase || '空闲');
    controller._releaseRunner(targetId, runner);
    controller._persist();
    const normalizedExitCode = Number(result.exitCode || 0);
    const notificationFailureText = normalizedExitCode === 0
      ? ''
      : controller._resolveNotificationFailureReason(targetId, {
        fallback: finalText || `任务失败，退出码 ${normalizedExitCode}`,
        exitCode: normalizedExitCode,
      });

    // The runner is released before sending notifications so queued follow-up
    // requests are not blocked by Telegram/network latency.
    controller.notifyConversationResult(targetId, normalizedExitCode === 0
      ? {
        status: 'completed',
        userText: completedUserText,
        assistantText: finalText,
      }
      : {
        status: 'failed',
        userText: completedUserText,
        assistantText: finalText,
        errorText: notificationFailureText,
        exitCode: normalizedExitCode,
      }).then((notifyResult) => {
      if (!notifyResult || notifyResult.skipped) {
        return;
      }
      if (notifyResult.ok) {
        controller._appendStructuredEvent(targetId, 'hint', '通知已发送');
      } else {
        controller._appendStructuredEvent(
          targetId,
          'warn',
          `通知发送失败: ${String(notifyResult.error || 'unknown error')}`,
        );
      }
      controller._persist();
    }).catch((error) => {
      controller._appendStructuredEvent(
        targetId,
        'warn',
        `通知发送失败: ${error?.message || String(error)}`,
      );
      controller._persist();
    });
    if (normalizedExitCode === 0) {
      controller._startNextQueuedMessage(targetId);
      return;
    }
    const pendingQueueSize = controller._pendingQueueSize(targetId);
    if (pendingQueueSize > 0) {
      controller._appendStructuredEvent(
        targetId,
        'warn',
        `当前任务非正常结束，剩余 ${pendingQueueSize} 条排队消息已停止自动执行`,
      );
    }
  });
}

module.exports = {
  bindChatRunnerEvents,
};
