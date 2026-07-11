import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createConversation } from '@/lib/chat'

/**
 * Feed / topic CTA: create (or reuse) a conversation with a character and
 * navigate into the chat. Topic-seeded entry passes `topicId` (server always
 * creates a new conversation in that case). Shared by FeedPage + TopicsPage.
 */
export function useStartChat() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ characterId, topicId }: { characterId: string; topicId?: string }) =>
      createConversation(characterId, topicId),
    onSuccess: ({ conversation }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      navigate(`/chat/${conversation.id}`)
    },
    onError: () => {
      toast.error('Could not start the chat — please try again.')
    },
  })
}
