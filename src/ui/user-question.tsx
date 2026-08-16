/**
 * Structured user-question prompt for the TUI (VC-KIMI-058).
 *
 * Renders the runtime's `UserQuestionRequest`, collects real answers for each
 * question (free text, single-select, or multi-select), and returns a
 * `UserQuestionResponse` that becomes the `ask_user` tool result.
 */

import { useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import type { UserQuestion, UserQuestionRequest, UserQuestionResponse } from '../agent/types.js';

export interface UserQuestionPromptProps {
  request: UserQuestionRequest;
  onSubmit: (response: UserQuestionResponse) => void;
}

function FreeTextQuestion({ onAnswer }: { onAnswer: (answer: string) => void }): JSX.Element {
  const [value, setValue] = useState('');
  return (
    <Box flexDirection="column">
      <Text dimColor>Type your answer and press Enter.</Text>
      <Box marginTop={1}>
        <TextInput value={value} onChange={setValue} onSubmit={(answer) => onAnswer(answer.trim())} />
      </Box>
    </Box>
  );
}

function SingleSelectQuestion({ question, onAnswer }: { question: UserQuestion; onAnswer: (answer: string) => void }): JSX.Element {
  const items = (question.options ?? []).map((option) => ({ key: option, label: option, value: option }));
  return (
    <Box flexDirection="column">
      <Text dimColor>Select an option.</Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => onAnswer(item.value)} />
      </Box>
    </Box>
  );
}

function MultiSelectQuestion({ question, onAnswer }: { question: UserQuestion; onAnswer: (answer: string) => void }): JSX.Element {
  const options = question.options ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const items = [
    ...options.map((option) => ({
      key: option,
      label: `${selected.includes(option) ? '[x] ' : '[ ] '}${option}`,
      value: option,
    })),
    { key: '__done__', label: `Done (${selected.length} selected)`, value: '__done__' },
  ];
  const handleSelect = (item: { value: string }) => {
    if (item.value === '__done__') {
      onAnswer(selected.join(', '));
      return;
    }
    setSelected((previous) => previous.includes(item.value)
      ? previous.filter((value) => value !== item.value)
      : [...previous, item.value]);
  };
  return (
    <Box flexDirection="column">
      <Text dimColor>Toggle options, then choose Done.</Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}

export function UserQuestionPrompt({ request, onSubmit }: UserQuestionPromptProps): JSX.Element {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const question = request.questions[index];

  const handleAnswer = (answer: string) => {
    const nextAnswers = [...answers, answer];
    if (index + 1 < request.questions.length) {
      setAnswers(nextAnswers);
      setIndex(index + 1);
    } else {
      onSubmit({ id: request.id, answers: nextAnswers });
    }
  };

  const options = question.options && question.options.length > 0;

  return (
    <Box flexDirection="column" borderStyle="single" padding={1} borderColor="magenta">
      <Text bold>
        Question {index + 1}/{request.questions.length}: {question.prompt}
      </Text>
      {options ? (
        question.multiSelect
          ? <MultiSelectQuestion question={question} onAnswer={handleAnswer} />
          : <SingleSelectQuestion question={question} onAnswer={handleAnswer} />
      ) : (
        <FreeTextQuestion onAnswer={handleAnswer} />
      )}
    </Box>
  );
}
