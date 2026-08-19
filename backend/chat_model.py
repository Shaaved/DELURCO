import torch
import torch.nn as nn
import nltk
import numpy as np
from nltk.stem.porter import PorterStemmer

# Download the required NLTK tokenizer package
nltk.download('punkt')

stemmer = PorterStemmer()

def tokenize(sentence):
    """Splits a sentence into an array of words/tokens"""
    return nltk.word_tokenize(sentence)

def stem(word):
    """Finds the root form of a word (e.g., 'ordering' -> 'order')"""
    return stemmer.stem(word.lower())

def bag_of_words(tokenized_sentence, all_words):
    """
    Creates an array of 1s and 0s indicating which words from the 
    known vocabulary are present in the user's sentence.
    """
    tokenized_sentence = [stem(w) for w in tokenized_sentence]
    bag = np.zeros(len(all_words), dtype=np.float32)
    for idx, w in enumerate(all_words):
        if w in tokenized_sentence:
            bag[idx] = 1.0
    return bag

class NeuralNet(nn.Module):
    """A standard feed-forward neural network with 3 linear layers"""
    def __init__(self, input_size, hidden_size, num_classes):
        super(NeuralNet, self).__init__()
        self.l1 = nn.Linear(input_size, hidden_size)
        self.l2 = nn.Linear(hidden_size, hidden_size)
        self.l3 = nn.Linear(hidden_size, num_classes)
        self.relu = nn.ReLU()
        
    def forward(self, x):
        out = self.l1(x)
        out = self.relu(out)
        out = self.l2(out)
        out = self.relu(out)
        out = self.l3(out)
        # We do not use softmax here as PyTorch's CrossEntropyLoss applies it automatically
        return out